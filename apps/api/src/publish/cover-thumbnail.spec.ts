import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInThisContext } from 'node:vm';
import ts from 'typescript';
import * as clipPath from '../clips/clip-path.ts';
import * as publicMedia from '../clips/public-media.ts';
import * as clipSocial from '../queue/clip-social.ts';
import * as queueConstants from '../queue/queue.constants.ts';
import * as instagramHelpers from './instagram-helpers.ts';
import * as helpers from './publish-helpers.ts';
import * as tiktokHelpers from './tiktok-helpers.ts';

// Run real decorated classes under the API's strip-types test runner.
function load<T>(name: string, dependencies: Record<string, unknown>): T {
  const file = fileURLToPath(new URL(`./${name}.ts`, import.meta.url));
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      experimentalDecorators: true,
    },
  });
  const require = createRequire(file);
  const exports = {};
  runInThisContext(`(function (exports, require) { ${outputText}\n})`, { filename: file })(
    exports, (id: string) => Object.hasOwn(dependencies, id) ? dependencies[id] : require(id),
  );
  return exports as T;
}

const tiktokApi = load<typeof import('../social/tiktok-api')>('../social/tiktok-api', {});
const { InstagramUploader } = load<typeof import('./instagram-uploader')>('instagram-uploader', {
  './publish-helpers': helpers,
  './instagram-helpers': instagramHelpers,
});
const { TiktokUploader } = load<typeof import('./tiktok-uploader')>('tiktok-uploader', {
  './publish-helpers': helpers,
  './tiktok-helpers': tiktokHelpers,
  '../social/tiktok-api': tiktokApi,
});
const { YoutubeUploader } = load<typeof import('./youtube-uploader')>('youtube-uploader', {
  './publish-helpers': helpers,
});
const publishService = load<typeof import('./publish.service')>('publish.service', {
  './publish-helpers': helpers,
  './instagram-helpers': instagramHelpers,
  '../clips/clip-path': clipPath,
  '../queue/clip-social': clipSocial,
  '../queue/queue.constants': queueConstants,
});
const { PublishProcessor } = load<typeof import('./publish.processor')>('publish.processor', {
  './publish-helpers': helpers,
  './instagram-helpers': instagramHelpers,
  './tiktok-helpers': tiktokHelpers,
  './publish.service': publishService,
  '../clips/clip-path': clipPath,
  '../clips/public-media': publicMedia,
  '../queue/queue.constants': queueConstants,
  '../social/tiktok-api': tiktokApi,
  '../social/social-provider': { SocialProviderError: class extends Error {} },
});

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const pngPath = 'covers/clip/cover.png';

async function tempClips(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'cover-thumbnail-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('sniffs complete JPEG and PNG signatures, not truncated signatures or other formats', () => {
  assert.deepEqual(helpers.sniffCoverImageMime(jpeg), { mime: 'image/jpeg', ext: 'jpg' });
  assert.deepEqual(helpers.sniffCoverImageMime(png), { mime: 'image/png', ext: 'png' });
  for (const bytes of [jpeg.subarray(0, 2), png.subarray(0, 7), Buffer.from('GIF89a'), Buffer.alloc(0)]) {
    assert.equal(helpers.sniffCoverImageMime(bytes), null);
  }
});

test('cover option readers handle missing and malformed JSON data', () => {
  for (const value of [undefined, null, 1, '', [], {}]) {
    assert.equal(helpers.coverTimestampFromOptions(value), null);
    assert.equal(helpers.coverFilePathFromOptions(value), null);
    assert.equal(helpers.coverErrorFromOptions(value), null);
    assert.equal(helpers.coverAppliedFromOptions(value), false);
  }
  for (const value of [-1, 1.5, NaN, Infinity, '0']) {
    assert.equal(helpers.coverTimestampFromOptions({ coverTimestampMs: value }), null);
  }
  for (const value of ['', '  ', 5]) {
    assert.equal(helpers.coverFilePathFromOptions({ coverFilePath: value }), null);
    assert.equal(helpers.coverErrorFromOptions({ coverError: value }), null);
  }
  const valid = { coverTimestampMs: 0, coverFilePath: pngPath, coverError: 'unavailable', coverApplied: true };
  assert.equal(helpers.coverTimestampFromOptions(valid), 0);
  assert.equal(helpers.coverFilePathFromOptions(valid), pngPath);
  assert.equal(helpers.coverErrorFromOptions(valid), 'unavailable');
  assert.equal(helpers.coverAppliedFromOptions(valid), true);
  assert.equal(helpers.coverAppliedFromOptions({ coverApplied: 'true' }), false);
});

test('Instagram sends a finite rounded thumb_offset including zero', async (t) => {
  const offsets: (string | null)[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: URL, init: RequestInit) => {
    offsets.push((init.body as URLSearchParams).get('thumb_offset'));
    return Response.json({ id: 'container' });
  });
  const uploader = new InstagramUploader();
  for (const thumbOffsetMs of [1200.6, 0, undefined, -1, Infinity]) {
    assert.equal(await uploader.createContainer({
      accessToken: 'token', igUserId: 'owner', videoUrl: 'https://media.example.com/reel.mp4', caption: '', thumbOffsetMs,
    }), 'container');
  }
  assert.deepEqual(offsets, ['1201', '0', null, null, null]);
});

test('TikTok sends a cover timestamp only for direct posting', async (t) => {
  const requests: { url: string; body: any }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(init.body as string) });
    return Response.json({ data: { publish_id: 'post', upload_url: 'https://upload.example.com' } });
  });
  const uploader = new TiktokUploader();
  const post = {
    title: '', privacyLevel: 'SELF_ONLY', disableComment: false, disableDuet: false, disableStitch: false,
    brandContent: false, brandOrganic: false, videoCoverTimestampMs: 10.6,
  };
  await uploader.startSession('token', 'direct', post, 1024);
  await uploader.startSession('token', 'direct', { ...post, videoCoverTimestampMs: 0 }, 1024);
  await uploader.startSession('token', 'direct', { ...post, videoCoverTimestampMs: -1 }, 1024);
  await uploader.startSession('token', 'inbox', post, 1024);
  assert.match(requests[0].url, /\/publish\/video\/init\/$/);
  assert.equal(requests[0].body.post_info.video_cover_timestamp_ms, 11);
  assert.equal(requests[1].body.post_info.video_cover_timestamp_ms, 0);
  assert.equal('video_cover_timestamp_ms' in requests[2].body.post_info, false);
  assert.match(requests[3].url, /\/publish\/inbox\/video\/init\/$/);
  assert.deepEqual(Object.keys(requests[3].body), ['source_info']);
});

test('YouTube posts raw thumbnail bytes with sniffed MIME and maps errors', async (t) => {
  const root = await tempClips(t);
  const imagePath = join(root, 'thumbnail.jpg');
  await writeFile(imagePath, png);
  let status: number | 'network' = 200;
  const request = t.mock.method(globalThis, 'fetch', async (_url: string, _init: RequestInit) => {
    if (status === 'network') throw new Error('connection dropped');
    return Response.json(status === 403 ? { error: { errors: [{ reason: 'forbidden' }] } } : {}, { status });
  });
  const uploader = new YoutubeUploader();
  await uploader.setThumbnail('token', 'id&?', imagePath);
  assert.deepEqual(request.mock.calls[0].arguments, [
    'https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=id%26%3F&uploadType=media',
    { method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'image/png', 'Content-Length': String(png.length) }, body: png },
  ]);
  status = 403;
  await assert.rejects(uploader.setThumbnail('token', 'id', imagePath), { name: 'PublishError', transient: false, message: /refused/ });
  status = 500;
  await assert.rejects(uploader.setThumbnail('token', 'id', imagePath), { name: 'PublishError', transient: true });
  status = 'network';
  await assert.rejects(uploader.setThumbnail('token', 'id', imagePath), { transient: true, message: 'Could not reach YouTube, retry later' });
  await assert.rejects(uploader.setThumbnail('token', 'id', join(root, 'missing')), { transient: false, message: 'Cover thumbnail file is missing' });
  await writeFile(imagePath, 'bad image');
  await assert.rejects(uploader.setThumbnail('token', 'id', imagePath), { transient: false, message: 'Invalid cover thumbnail image' });
  assert.equal(request.mock.callCount(), 4);
});

function makeService(clipsDir: string, prisma: object, queue = {}) {
  const { PublishService } = publishService;
  return new PublishService(...[prisma, queue, { clipsDir }] as ConstructorParameters<typeof PublishService>);
}

test('uploadCover checks ownership and deletion, validates bytes and stores an exclusive generated file', async (t) => {
  const root = await tempClips(t);
  const service = makeService(root, { clip: { findFirst: async ({ where }) => {
    assert.equal(where.deletedAt, null);
    return where.id === 'clip' && where.job.userId === 'owner' ? { id: 'clip' } : null;
  } } });
  await assert.rejects(service.uploadCover('other', 'clip', { buffer: png }), { status: 404 });
  await assert.rejects(service.uploadCover('owner', 'deleted', { buffer: png }), { status: 404 });
  await assert.rejects(service.uploadCover('owner', 'clip'), { status: 400 });
  for (const buffer of [Buffer.alloc(0), Buffer.alloc(helpers.MAX_COVER_IMAGE_BYTES + 1), Buffer.from('not an image')]) {
    await assert.rejects(service.uploadCover('owner', 'clip', { buffer }), { status: 400 });
  }
  const first = await service.uploadCover('owner', 'clip', { buffer: png });
  const second = await service.uploadCover('owner', 'clip', { buffer: jpeg });
  assert.match(first.coverId, /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i);
  assert.notEqual(first.coverId, second.coverId);
  assert.deepEqual(await readFile(join(root, 'covers', 'clip', `${first.coverId}.png`)), png);
  assert.deepEqual(await readFile(join(root, 'covers', 'clip', `${second.coverId}.jpg`)), jpeg);
});

test('publish scopes the cover file to the clip and maps cover options per platform', async (t) => {
  const root = await tempClips(t);
  const platforms = { yt: 'youtube', ig: 'instagram', tt: 'tiktok' };
  const created: any[] = [];
  const publication = {
    findFirst: async () => null,
    create: async ({ data }) => {
      const row = { ...data, id: `pub-${created.length}`, createdAt: new Date(), updatedAt: new Date() };
      created.push(row);
      return row;
    },
    findMany: async ({ where }) => created.filter(({ id }) => where.id.in.includes(id)),
  };
  const service = makeService(root, {
    clip: { findFirst: async ({ where }) => ({ id: where.id, deletedAt: null }) },
    socialAccount: { findMany: async ({ where }) => where.id.in.map((id: string) => ({ id, platform: platforms[id] })) },
    publication,
    $transaction: async (fn: (tx: object) => Promise<unknown>) => fn({ publication }),
  }, { getJob: async () => null, add: async () => undefined });
  const cover = await service.uploadCover('owner', 'clip', { buffer: png });
  const yt = { accountId: 'yt', title: 'video', caption: '', privacy: 'private' } as const;
  const ig = { accountId: 'ig', caption: '' };
  const tt = { accountId: 'tt', caption: '', mode: 'direct', tiktok: {
    privacyLevel: 'SELF_ONLY', disableComment: true, disableDuet: false, disableStitch: false, brandContent: false, brandOrganic: false,
  } } as const;
  const dto = { ...cover, coverTimestampMs: 8.8, targets: [yt, ig, tt] };
  const rows = await service.publish('clip', dto, 'owner');
  assert.deepEqual(created.map(({ options }) => options), [
    { coverTimestampMs: 9, coverFilePath: `covers/clip/${cover.coverId}.png` },
    { coverTimestampMs: 9 },
    { ...tt.tiktok, coverTimestampMs: 9 },
  ]);
  assert.deepEqual(rows.map(({ coverTimestampMs, coverError }) => [coverTimestampMs, coverError]), [[9, null], [9, null], [9, null]]);
  assert.equal(publishService.toPublicationResponse({ ...created[0], options: { coverError: 'refused' } }).coverError, 'refused');
  const inbox = await service.publish('clip', { ...dto, targets: [{ accountId: 'tt', caption: '', mode: 'inbox' }] }, 'owner');
  assert.equal(inbox[0].coverTimestampMs, null);
  assert.equal(created[3].options, undefined);
  await service.publish('clip', { targets: [yt] }, 'owner');
  assert.equal(created[4].options, undefined);
  await assert.rejects(service.publish('other-clip', dto, 'owner'), { status: 400, message: 'Cover thumbnail not found for this clip' });
  const badId = '00000000-0000-4000-8000-000000000000';
  await mkdir(join(root, 'covers', 'clip', `${badId}.jpg`));
  await assert.rejects(service.publish('clip', { ...dto, coverId: badId }, 'owner'), { status: 400 });
  await assert.rejects(service.publish('clip', { ...dto, coverId: `../clip/${cover.coverId}` }, 'owner'), { status: 400 });
  assert.equal(created.length, 5);
});

function makeProcessor(
  clipsDir: string,
  setThumbnail: (accessToken: string, videoId: string, filePath: string) => Promise<void>,
  options: object = { coverTimestampMs: 10, coverFilePath: pngPath },
  state = 'published',
) {
  let updates: any[] = [];
  let scheduled: unknown[] = [];
  const publication = { platform: 'youtube', status: 'processing', externalId: 'video', socialAccountId: 'account', options };
  const worker = new PublishProcessor(...[
    { publication: {
      findUnique: async () => publication,
      updateMany: async (update: object) => { updates.push(update); return { count: 1 }; },
    } },
    { clipsDir },
    { getValidAccessToken: async () => 'token' },
    { videoStatus: async () => ({ state }), setThumbnail },
    {}, {}, {}, {},
    { add: async (_name: string, job: object) => { scheduled.push(job); } },
  ] as ConstructorParameters<typeof PublishProcessor>);
  return {
    updates, scheduled,
    check: (checks: number) => worker.process({ data: { kind: 'check', publicationId: 'pub', checks } } as Parameters<typeof worker.process>[0]),
  };
}

test('the YouTube check applies a thumbnail at the published state or final check', async () => {
  for (const [state, checks] of [['published', 1], ['processing', helpers.MAX_PROCESSING_CHECKS]] as const) {
    const calls: string[][] = [];
    const { updates, scheduled, check } = makeProcessor('/clips', async (...args) => { calls.push(args); }, undefined, state);
    await check(checks);
    assert.deepEqual(calls, [['token', 'video', join('/clips', pngPath)]]);
    assert.equal(scheduled.length, 0);
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].where, { id: 'pub', status: 'processing' });
    assert.equal(updates[0].data.status, 'published');
    assert.deepEqual(updates[0].data.options, { coverTimestampMs: 10, coverFilePath: pngPath, coverApplied: true, coverError: null });
  }
});

test('the YouTube check reschedules a transient thumbnail error without publishing', async () => {
  const { updates, scheduled, check } = makeProcessor('/clips', async () => { throw new helpers.PublishError('retry later', true); });
  await check(1);
  assert.deepEqual(scheduled, [{ publicationId: 'pub', kind: 'check', checks: 2 }]);
  assert.deepEqual(updates, []);
});

test('the YouTube check publishes on 403 or exhausted retries, recording only a cover error', async () => {
  const response403 = { error: { errors: [{ reason: 'forbidden' }] } };
  const forbidden = helpers.mapGoogleError(403, response403);
  for (const [error, checks] of [
    [new helpers.PublishError(forbidden), 1],
    [new helpers.PublishError('retry later', true), helpers.MAX_PROCESSING_CHECKS],
  ] as const) {
    const { updates, scheduled, check } = makeProcessor('/clips', async () => { throw error; });
    await check(checks);
    assert.deepEqual(scheduled, []);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].data.status, 'published');
    assert.equal(updates[0].data.error, undefined);
    assert.deepEqual(updates[0].data.options, { coverTimestampMs: 10, coverFilePath: pngPath, coverError: error.message });
  }
});

test('the YouTube check skips thumbnails already applied', async () => {
  const apply = test.mock.fn(async () => undefined);
  const { updates, check } = makeProcessor('/clips', apply, { coverFilePath: pngPath, coverApplied: true });
  await check(1);
  assert.equal(apply.mock.callCount(), 0);
  assert.equal(updates[0].data.status, 'published');
  assert.equal(updates[0].data.options, undefined);
});
