import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), '../..');
const read = (path: string) => readFile(join(root, path), 'utf8');

test('nama antrean frame sama di shared dan API', async () => {
  for (const path of ['packages/shared/src/index.ts', 'apps/api/src/queue/queue.constants.ts']) {
    assert.match(await read(path), /FRAME_QUEUE_NAME = 'clip-frames'/);
  }
  assert.match(await read('apps/api/src/queue/queue.module.ts'), /registerQueue\(\{ name: FRAME_QUEUE_NAME \}\)/);
});

test('kontrak data job frame', async () => {
  const shared = await read('packages/shared/src/index.ts');
  assert.match(shared, /export type FrameStatus = 'queued' \| 'running' \| 'done' \| 'failed'/);
  assert.match(shared, /export interface FrameJobData \{/);
  for (const field of ['url', 'atSec', 'aspectRatio', 'reframe', 'twoSpeakers', 'facecam', 'captions', 'captionSample', 'outPath', 'userId']) {
    assert.match(shared, new RegExp(`${field}:`));
  }
  const service = await read('apps/api/src/frames/frames.service.ts');
  assert.match(service, /assertAllowedUrl\(dto\.url\)/);
  assert.match(service, /aspectRatio === '9:16' \? \(dto\.twoSpeakers \?\? false\) : false/);
  assert.match(service, /aspectRatio === '9:16' && !twoSpeakers \? \(dto\.facecam \?\? false\) : false/);
  assert.match(service, /captionSample: 'Sample caption'/);
  assert.match(service, /outPath: `\.frames\/\$\{id\}\.jpg`/);
  assert.match(service, /queue\.add\('frame', data/);
  assert.match(service, /attempts: 1/);
  assert.match(service, /removeOnComplete: \{ age: FRAME_TTL_SECONDS \}/);
  assert.match(service, /removeOnFail: \{ age: FRAME_TTL_SECONDS \}/);
  assert.match(service, /getJobs\(\['waiting', 'active'\]\)/);
  assert.match(service, /HttpException\(.+, 429\)/);
});

test('endpoint frame ada di controller berautentikasi', async () => {
  const controller = await read('apps/api/src/frames/frames.controller.ts');
  assert.match(controller, /@Controller\('frames'\)/);
  assert.match(controller, /@Post\(\)/);
  assert.match(controller, /@Get\(':id'\)/);
  assert.match(controller, /@Get\(':id\/image'\)/);
  assert.match(controller, /@CurrentUser\(\)/);
  assert.doesNotMatch(controller, /@Public\(\)/);
  const module = await read('apps/api/src/app.module.ts');
  assert.match(module, /FramesModule/);
});

test('gambar frame dilayani owner-only dengan path guard', async () => {
  const service = await read('apps/api/src/frames/frames.service.ts');
  assert.match(service, /resolveClipPath\(this\.config\.clipsDir, `\.frames\/\$\{id\}\.jpg`\)/);
  assert.match(service, /data\?\.userId !== userId/);
  assert.match(service, /Content-Type', 'image\/jpeg'/);
  assert.match(service, /Cache-Control', 'private, max-age=3600'/);
  assert.match(service, /createReadStream\(absolutePath\)\.pipe\(res\)/);
});

test('validasi DTO frame mengikuti batas create-job', async () => {
  const dto = await read('apps/api/src/frames/dto/create-frame.dto.ts');
  assert.match(dto, /@Max\(36000\)/);
  assert.match(dto, /@IsIn\(ASPECT_RATIOS\)/);
  assert.match(dto, /@IsIn\(REFRAME_MODES\)/);
});
