import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BadRequestException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { MEDIA_MAX_PER_USER, MEDIA_UPLOAD_MAX_BYTES } from '@clipper/shared';
import { loadSource } from '../testing/load-source.ts';

const resolve = createRequire(import.meta.url).resolve;
const { MediaService } = loadSource<typeof import('./media.service')>(resolve('./media.service.ts'));
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
