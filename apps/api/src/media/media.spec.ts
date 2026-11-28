import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { BadRequestException, NotFoundException, RequestMethod, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { MEDIA_IMAGE_MAX_BYTES, MEDIA_MAX_PER_USER, MEDIA_UPLOAD_MAX_BYTES } from '@clipper/shared';
import { loadSource } from '../testing/load-source.ts';

const resolve = createRequire(import.meta.url).resolve;
const { MediaService } = loadSource<typeof import('./media.service')>(resolve('./media.service.ts'));
const { MediaActionsService } = loadSource<typeof import('./media-actions.service')>(resolve('./media-actions.service.ts'));
const { MediaController } = loadSource<typeof import('./media.controller')>(resolve('./media.controller.ts'));
const { CaptureMediaFrameDto, FindMediaMomentDto, GenerateMediaImageDto } =
  loadSource<typeof import('./media.dto')>(resolve('./media.dto.ts'));
const ffmpegAvailable = ['ffmpeg', 'ffprobe'].every((binary) => {
  try { execFileSync(binary, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
});
const { MediaResolverService } = loadSource<typeof import('./media-resolver.service')>(resolve('./media-resolver.service.ts'));
const { JobsService } = loadSource<typeof import('../jobs/jobs.service')>(resolve('../jobs/jobs.service.ts'));
const { CreateJobDto } = loadSource<typeof import('../jobs/dto/create-job.dto')>(resolve('../jobs/dto/create-job.dto.ts'));
const { PreviewsService } = loadSource<typeof import('../previews/previews.service')>(resolve('../previews/previews.service.ts'));
const { CreatePreviewDto } = loadSource<typeof import('../previews/dto/create-preview.dto')>(resolve('../previews/dto/create-preview.dto.ts'));
const { CreateFrameDto } = loadSource<typeof import('../frames/dto/create-frame.dto')>(resolve('../frames/dto/create-frame.dto.ts'));
const { FramesService } = loadSource<typeof import('../frames/frames.service')>(resolve('../frames/frames.service.ts'));

const userId = 'owner';
const url = 'https://www.youtube.com/watch?v=example';
const primary = { kind: 'upload', mediaId: 'asset' } as const;
const secondary = { kind: 'clip', clipId: 'clip' } as const;
const config = {
  enabled: true, ratio: '50:50', swap: false, primaryFit: 'cover', secondaryFit: 'contain_blur',
  secondaryVolume: 1.5, matchMode: 'auto', clips: [secondary],
} as const;
const split = { ...config, clips: [secondary] };
const opts = { aspectRatio: '9:16', facecam: false, twoSpeakers: false } as const;

function fixture() {
  const asset = { id: 'asset', userId, name: 'Upload', filePath: 'media/owner/asset.mp4', durationSec: 25 };
  const clip = { id: 'clip', title: 'Clip', filePath: 'job/clip.mp4', startSec: 20, endSec: 32, transcript: 'Transcript' };
  const prisma = {
    mediaAsset: { findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
      where.id === asset.id && where.userId === asset.userId ? asset : null },
    clip: { findFirst: async ({ where }: { where: { id: string; deletedAt: null; job: { userId: string } } }) =>
      where.id === clip.id && where.deletedAt === null && where.job.userId === userId ? clip : null },
  };
  const media = new MediaService(...[prisma, {}] as unknown as ConstructorParameters<typeof MediaService>);
  const resolver = new MediaResolverService(...[prisma, media] as unknown as ConstructorParameters<typeof MediaResolverService>);
  return { resolver, asset, clip };
}

test('resolver validates URL sources and derives local metadata only from owned rows', async () => {
  const { resolver, asset, clip } = fixture();
  assert.deepEqual(await resolver.resolvePrimarySource(userId, url), { url, primarySource: null });
  assert.deepEqual(await resolver.resolvePrimarySource(userId, undefined, { kind: 'url', url }), { url, primarySource: null });
  await assert.rejects(resolver.resolvePrimarySource(userId, 'https://example.org/video'), BadRequestException);
  for (const source of [primary, secondary]) {
    await assert.rejects(resolver.resolvePrimarySource('other-user', undefined, source), NotFoundException);
    await assert.rejects(resolver.resolveSplitScreen('other-user', { ...split, clips: [source] }, opts), NotFoundException);
  }
  assert.deepEqual(await resolver.resolvePrimarySource(userId, undefined, { ...primary, filePath: '/untrusted' }), {
    url: 'media://asset', primarySource: { ...primary, filePath: asset.filePath, label: asset.name, durationSec: 25 },
  });
  assert.deepEqual(await resolver.resolvePrimarySource(userId, undefined, { ...secondary, label: ' Custom ' }), {
    url: 'clip://clip', primarySource: { ...secondary, filePath: clip.filePath, label: 'Custom', durationSec: 12 },
  });
});

test('resolver enforces split-screen layout, unique IDs, URL and bounds', async () => {
  const { resolver, clip } = fixture();
  assert.equal(await resolver.resolveSplitScreen(userId, null, opts), null);
  for (const options of [{ ...opts, aspectRatio: '1:1' as const }, { ...opts, twoSpeakers: true }, { ...opts, facecam: true }]) {
    await assert.rejects(resolver.resolveSplitScreen(userId, split, options), BadRequestException);
  }
  for (const clips of [[], Array(11).fill(secondary), [secondary, { ...secondary, id: ' b1 ' }],
    [{ kind: 'url' as const, url, startSec: 2, endSec: 2 }], [{ kind: 'url' as const, url: 'https://example.org' }]]) {
    await assert.rejects(resolver.resolveSplitScreen(userId, { ...split, clips }, opts), BadRequestException);
  }
  const result = await resolver.resolveSplitScreen(userId, { ...split, clips: [secondary, { kind: 'url', url, id: ' custom ' }, primary] }, opts);
  assert.equal(result?.secondaryVolume, 1);
  assert.deepEqual(result?.clips.map(({ id, label }) => ({ id, label })), [
    { id: 'b1', label: 'Clip' }, { id: 'custom', label: url }, { id: 'b3', label: 'Upload' },
  ]);
  assert.equal(result?.clips[0].description, clip.transcript);
});

test('MediaService rejects size/quota violations and removes temp files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clip-media-'));
  const prisma = { mediaAsset: { count: async () => MEDIA_MAX_PER_USER } };
  const service = new MediaService(...[prisma, { clipsDir: root }] as unknown as ConstructorParameters<typeof MediaService>);
  try {
    for (const [size, message] of [[MEDIA_UPLOAD_MAX_BYTES + 1, /100 MiB/], [1, /50 media/]] as const) {
      const path = join(root, 'temp-upload');
      await writeFile(path, 'x');
      await assert.rejects(service.upload({ path, size, originalname: 'video.mp4' }, null, userId), message);
      await assert.rejects(stat(path), { code: 'ENOENT' });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const pipe = new ValidationPipe({ transform: true, whitelist: true });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jIq0AAAAASUVORK5CYII=', 'base64');

async function actionFixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'clip-media-actions-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  type Row = { id: string; userId: string; mimeType: string; durationSec: number; filePath: string; name: string };
  const rows: Row[] = [];
  let full = false;
  let locked = 0;
  const mediaAsset = {
    count: async ({ where }: { where: { userId: string } }) => full ? MEDIA_MAX_PER_USER : rows.filter((row) => row.userId === where.userId).length,
    create: async ({ data }: { data: Row }) => {
      const row = { ...data, createdAt: new Date(0) };
      rows.push(row);
      return row;
    },
    findFirst: async ({ where }: { where: { id: string; userId: string } }) => rows.find((row) => row.id === where.id && row.userId === where.userId),
  };
  const prisma = {
    mediaAsset,
    clip: { findFirst: async ({ where }: { where: { id: string; deletedAt: null; job: { userId: string } } }) =>
      where.id === 'clip' && where.deletedAt === null && where.job.userId === userId
        ? { id: 'clip', filePath: 'clips/sample.mp4', startSec: 42, endSec: 44, title: 'Sample' } : null },
    $transaction: async (fn: (tx: unknown) => unknown) => fn({ mediaAsset, $queryRaw: async () => { locked++; } }),
  };
  const config = { clipsDir: root };
  const media = new MediaService(...[prisma, config] as unknown as ConstructorParameters<typeof MediaService>);
  const resolver = new MediaResolverService(...[prisma, media] as unknown as ConstructorParameters<typeof MediaResolverService>);
  type Payload = { outPath?: string; [key: string]: unknown };
  const calls: { name: string; data: Payload; timeout: number }[] = [];
  let answer = async (_name: string, _data: Payload): Promise<unknown> => { throw new Error('Unexpected queue call'); };
  const queue = { add: async (name: string, data: Payload) => ({
    waitUntilFinished: async (_events: unknown, timeout: number) => { calls.push({ name, data, timeout }); return answer(name, data); },
    remove: async () => undefined,
  }) };
  const actions = new MediaActionsService(...[media, resolver, config, queue, {}] as unknown as ConstructorParameters<typeof MediaActionsService>);
  return { root, media, resolver, actions, rows, calls, setAnswer: (fn: typeof answer) => { answer = fn; },
    lockCount: () => locked, setFull: () => { full = true; } };
}

test('media actions expose POST routes and forward the session owner, not the body owner', async () => {
  const posted: unknown[][] = [];
  const controller = new MediaController(...[{}, Object.fromEntries(['captureFrame', 'generateImage', 'findMoment']
    .map((key) => [key, (...args: unknown[]) => posted.push(args)]))] as unknown as ConstructorParameters<typeof MediaController>);
  assert.equal(Reflect.getMetadata(PATH_METADATA, MediaController), 'media');
  for (const [method, route] of [['captureFrame', 'capture-frame'], ['generateImage', 'generate-image'], ['findMoment', 'find-moment']] as const) {
    assert.equal(Reflect.getMetadata(PATH_METADATA, controller[method]), route);
    assert.equal(Reflect.getMetadata(METHOD_METADATA, controller[method]), RequestMethod.POST);
    const body = { ...primary, atSec: 0, prompt: 'Hello', userId: 'untrusted' };
    await controller[method](body, { id: userId });
    assert.deepEqual(posted.at(-1), [body, userId]);
  }
});

test('media action DTOs validate flat inputs and strip injected paths', async () => {
  const capture = { type: 'body' as const, metatype: CaptureMediaFrameDto };
  const dto = await pipe.transform({ ...primary, atSec: 0, filePath: '/arbitrary', outPath: '/arbitrary' }, capture);
  assert.equal(dto.filePath, undefined);
  assert.equal(dto.outPath, undefined);
  for (const input of [{ kind: 'upload', atSec: 0 }, { ...primary, atSec: -1 }, { ...primary, atSec: Infinity }]) {
    await assert.rejects(pipe.transform(input, capture), BadRequestException);
  }
  await assert.rejects(pipe.transform({ prompt: '  ', aspectRatio: '1:1' }, { type: 'body', metatype: GenerateMediaImageDto }), BadRequestException);
  await assert.rejects(pipe.transform({ prompt: 'cat', aspectRatio: '2:3' }, { type: 'body', metatype: GenerateMediaImageDto }), BadRequestException);
  await assert.rejects(pipe.transform({ ...primary, prompt: 'cat', targetDurationSec: 0 }, { type: 'body', metatype: FindMediaMomentDto }), BadRequestException);
});

test('image uploads validate file bytes, size and ownership; only split-screen accepts them', { skip: !ffmpegAvailable }, async (t) => {
  const { root, media, resolver, lockCount } = await actionFixture(t);
  const upload = join(root, 'upload');
  await writeFile(upload, png);
  const asset = await media.upload({ path: upload, size: png.length, originalname: 'image.mp4' }, '  Photo  ', userId);
  assert.equal(asset.mediaType, 'image');
  assert.equal(asset.mimeType, 'image/png');
  assert.equal(asset.durationSec, 0);
  assert.equal(asset.name, 'Photo');
  assert.equal(lockCount(), 1);
  const source = { kind: 'upload', mediaId: asset.id, mediaType: 'video', momentPrompt: 'look', startSec: 1 } as const;
  await assert.rejects(resolver.resolvePrimarySource(userId, undefined, source), BadRequestException);
  await assert.rejects(resolver.resolveVideoActionSource(userId, source), BadRequestException);
  await assert.rejects(resolver.resolveSplitScreen('not-owner', { ...split, clips: [source] }, opts), NotFoundException);
  const result = await resolver.resolveSplitScreen(userId, { ...split, clips: [source] }, opts);
  assert.equal(result?.clips[0].mediaType, 'image');
  assert.equal(result?.clips[0].startSec, undefined);
  assert.equal(result?.clips[0].momentPrompt, undefined);
  await writeFile(upload, png);
  await truncate(upload, MEDIA_IMAGE_MAX_BYTES + 1);
  await assert.rejects(media.upload({ path: upload, size: 1, originalname: 'large.png' }, null, userId), /15 MiB/);
  await assert.rejects(stat(upload), { code: 'ENOENT' });
  await writeFile(upload, png.subarray(0, 16));
  await assert.rejects(media.upload({ path: upload, size: 16, originalname: 'broken.png' }, null, userId), BadRequestException);
  await assert.rejects(stat(upload), { code: 'ENOENT' });
});

test('worker media jobs validate contracts and clean their temporary files', { skip: !ffmpegAvailable }, async (t) => {
  const { root, actions, calls, setAnswer, setFull } = await actionFixture(t);
  setAnswer(async (name, data) => {
    if (name === 'find-moment') return { startSec: 2, endSec: 5, durationSec: 8, reason: 'Match', extra: 'not returned' };
    assert.equal((await stat(join(root, data.outPath!, '..'))).mode & 0o7777, 0o1777);
    await writeFile(join(root, data.outPath!), png);
    return { file: data.outPath, mimeType: 'image/png', width: 1, height: 1, sizeBytes: png.length };
  });
  const image = await actions.generateImage({ prompt: 'A photo', aspectRatio: '16:9' }, userId);
  const frame = await actions.captureFrame({ kind: 'url', url, atSec: 0 }, userId);
  const moment = await actions.findMoment({ kind: 'url', url, prompt: 'Find a moment', targetDurationSec: 3 }, userId);
  assert.equal(image.mediaType, 'image');
  assert.equal(frame.mediaType, 'image');
  assert.deepEqual(moment, { startSec: 2, endSec: 5, reason: 'Match', durationSec: 8 });
  assert.deepEqual(calls.map(({ name }) => name), ['generate-image', 'capture-frame', 'find-moment']);
  assert.deepEqual(calls[1].data, { kind: 'url', url, atSec: 0, outPath: calls[1].data.outPath });
  assert.ok(calls.every(({ timeout }) => Number.isFinite(timeout) && timeout > 0));
  assert.deepEqual(await readdir(join(root, '.tmp-media')), []);
  setAnswer(async (_name, data) => {
    assert.equal((await stat(join(root, data.outPath!, '..'))).mode & 0o7777, 0o1777);
    await writeFile(join(root, data.outPath!), png);
    return { file: '../unexpected.png', mimeType: 'image/png', width: 1, height: 1, sizeBytes: png.length };
  });
  await assert.rejects(actions.generateImage({ prompt: 'Photo' }, userId), ServiceUnavailableException);
  setAnswer(async () => ({ startSec: 2, endSec: 1 }));
  await assert.rejects(actions.findMoment({ kind: 'url', url, prompt: 'Moment' }, userId), ServiceUnavailableException);
  assert.deepEqual(await readdir(join(root, '.tmp-media')), []);
  const jobsBeforeQuota = calls.length;
  setFull();
  await assert.rejects(actions.generateImage({ prompt: 'Photo' }, userId), /50 media/);
  assert.equal(calls.length, jobsBeforeQuota);
});

test('local capture uses ffmpeg on owned files only; local find-moment enqueues a relative path', { skip: !ffmpegAvailable }, async (t) => {
  const { root, actions, rows, calls, setAnswer } = await actionFixture(t);
  const source = join(root, 'clips/sample.mp4');
  await mkdir(join(root, 'clips'));
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32:d=2', '-c:v', 'mpeg4', source]);
  rows.push({ id: 'asset', name: 'Video', userId, durationSec: 2, mimeType: 'video/mp4', filePath: 'clips/sample.mp4' });
  for (const input of [primary, secondary]) {
    await assert.rejects(actions.captureFrame({ ...input, atSec: 0 }, 'not-owner'), NotFoundException);
    await assert.rejects(actions.captureFrame({ ...input, atSec: 2 }, userId), BadRequestException);
    const frame = await actions.captureFrame({ ...input, atSec: 0 }, userId);
    assert.equal(frame.mimeType, 'image/jpeg');
    assert.equal(frame.width, 32);
  }
  assert.deepEqual(calls, []);
  setAnswer(async () => ({ startSec: 0, endSec: 1 }));
  await actions.findMoment({ ...secondary, prompt: 'Blue' }, userId);
  assert.deepEqual(calls[0].data, { kind: 'clip', filePath: 'clips/sample.mp4', prompt: 'Blue', targetDurationSec: undefined });
  const outside = await mkdtemp(join(tmpdir(), 'clip-media-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'sample.mp4'), 'outside');
  await symlink(outside, join(root, 'escape'));
  for (const filePath of ['../outside.mp4', 'escape/sample.mp4', source]) {
    rows[0].filePath = filePath;
    await assert.rejects(actions.captureFrame({ ...primary, atSec: 0 }, userId), NotFoundException);
    await assert.rejects(actions.findMoment({ ...primary, prompt: 'Blue' }, userId), NotFoundException);
  }
  assert.equal(calls.length, 1);
});

test('job, preview and frame DTOs accept a local source without URL and reject missing sources', async () => {
  for (const [metatype, extra] of [[CreateJobDto, { mode: 'auto' }], [CreatePreviewDto, {}], [CreateFrameDto, { atSec: 0 }]] as const) {
    const meta = { type: 'body' as const, metatype };
    await assert.rejects(pipe.transform(extra, meta), BadRequestException);
    await assert.rejects(pipe.transform({ ...extra, primarySource: { kind: 'upload' } }, meta), BadRequestException);
    const dto = await pipe.transform({ ...extra, primarySource: { ...primary, filePath: '/bad' }, splitScreen: split }, meta);
    assert.equal(dto.primarySource.mediaId, primary.mediaId);
    assert.equal(dto.primarySource.filePath, undefined);
    assert.equal(dto.splitScreen.clips[0].clipId, secondary.clipId);
  }
});

test('jobs persist and enqueue local primary, split-screen and manual timeline on create and retry', async () => {
  const { resolver } = fixture();
  const persisted: Record<string, unknown>[] = [];
  const queued: Record<string, unknown>[] = [];
  const prisma = { job: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      persisted.push(data);
      return { id: 'job-id' };
    },
    findUnique: async () => ({ ...persisted[0], status: 'failed', clips: [] }),
  } };
  const queue = { add: async (_: string, data: Record<string, unknown>) => { queued.push(data); } };
  const deps = [prisma, {}, {}, { resolveSettings: async () => [] }, { resolveSettings: async () => null }, {}, queue, resolver];
  const service = new JobsService(...deps as unknown as ConstructorParameters<typeof JobsService>);
  const timeline = [{ atStart: 0, atEnd: 5, clipId: 'b1', sourceStartSec: 1, reason: 'Match' }];
  const dto = await pipe.transform({
    mode: 'manual', primarySource: primary, splitScreen: split, ranges: [{ start: 1, end: 9, splitTimeline: timeline }],
  }, { type: 'body', metatype: CreateJobDto });
  await service.create(dto, userId);
  await service.retry('job-id', userId);
  for (const data of [...persisted, ...queued]) {
    assert.equal(data.url, 'media://asset');
    assert.equal((data.primarySource as { mediaId: string }).mediaId, 'asset');
    assert.equal((data.splitScreen as { clips: { id: string }[] }).clips[0].id, 'b1');
    assert.deepEqual(JSON.parse(JSON.stringify(data.ranges)), [{ start: 1, end: 9, splitTimeline: timeline }]);
  }
});

test('previews expose resolved options and worker summaries; frames enqueue resolved options', async () => {
  const { resolver } = fixture();
  let data: Record<string, unknown> = {};
  const queue = {
    add: async (_: string, value: Record<string, unknown>) => { data = value; },
    getJobs: async () => [],
    getJob: async () => ({ data, getState: async () => 'completed', returnvalue: JSON.stringify({
      cues: [], candidates: [], brollSummaries: { b1: 'Summary', invalid: 123 },
    }) }),
  };
  const previews = new PreviewsService(...[queue, resolver] as unknown as ConstructorParameters<typeof PreviewsService>);
  const preview = await previews.create(Object.assign(new CreatePreviewDto(), { primarySource: primary, splitScreen: split }), userId);
  const response = await previews.findOne(preview.id, userId);
  assert.equal(response.primarySource?.filePath, 'media/owner/asset.mp4');
  assert.equal(response.splitScreen?.clips[0].filePath, 'job/clip.mp4');
  assert.deepEqual(response.brollSummaries, { b1: 'Summary' });
  const frames = new FramesService(...[{}, queue, resolver] as unknown as ConstructorParameters<typeof FramesService>);
  await frames.create(Object.assign(new CreateFrameDto(), { atSec: 0, primarySource: primary, splitScreen: split }), userId);
  assert.deepEqual(data.primarySource, response.primarySource);
  assert.deepEqual(data.splitScreen, response.splitScreen);
});
