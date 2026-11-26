import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInThisContext } from 'node:vm';
import 'reflect-metadata';
import { validateSync } from 'class-validator';
import ts from 'typescript';
import * as shared from '@clipper/shared';
import * as watermarkHelpers from '../watermarks/watermark-helpers.ts';

const { CAPTION_PRESET_STYLES, normalizeCaptionStyle } = shared;

const root = join(process.cwd(), '../..');

test('schema.prisma has captions Boolean default true and migration exists', async () => {
  const schema = await readFile(join(root, 'apps/api/prisma/schema.prisma'), 'utf8');
  assert.match(schema, /captions\s+Boolean\s+@default\(true\)/);

  const migration = await readFile(
    join(root, 'apps/api/prisma/migrations/20260106000000_add_job_captions/migration.sql'),
    'utf8',
  );
  assert.match(migration, /ALTER TABLE "jobs" ADD COLUMN "captions" BOOLEAN NOT NULL DEFAULT true;/);
});

test('shared JobData includes captions', async () => {
  const shared = await readFile(join(root, 'packages/shared/src/index.ts'), 'utf8');
  assert.match(shared, /captions:\s*boolean;/);
});

test('CreateJobDto has optional captions defaulting to true', async () => {
  const dto = await readFile(join(root, 'apps/api/src/jobs/dto/create-job.dto.ts'), 'utf8');
  assert.match(dto, /@IsBoolean\(\)/);
  assert.match(dto, /captions:\s*boolean\s*=\s*true;/);
});

test('custom positionY is clamped, rounded, and never matches a named preset', () => {
  for (const [input, expected] of [[-1, 0.05], [2, 0.95], [0.34567, 0.3457]]) {
    const style = normalizeCaptionStyle({ preset: 'beast', positionY: input });
    assert.deepEqual(style, { ...CAPTION_PRESET_STYLES.beast, preset: 'custom', positionY: expected });
  }
  for (const positionY of [undefined, null, NaN, Infinity, '0.5']) {
    assert.deepEqual(normalizeCaptionStyle({ preset: 'beast', positionY }), CAPTION_PRESET_STYLES.beast);
  }
});

test('CreateJobDto accepts absent, null, and in-range positionY and rejects invalid values', async () => {
  const file = join(root, 'apps/api/src/jobs/dto/create-job.dto.ts');
  // Node's strip-types runner cannot load decorators, so transpile the DTO alone.
  const { outputText } = ts.transpileModule(await readFile(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
  });
  const exports: Record<string, unknown> = {};
  const require = createRequire(file);
  const load = runInThisContext(`(function (exports, require) { ${outputText}\n})`, { filename: file });
  load(exports, (id: string) => id === '@clipper/shared' ? shared :
    id === '../../watermarks/watermark-helpers' ? watermarkHelpers : require(id));
  const CreateJobDto = exports.CreateJobDto as new () => object;

  for (const [positionY, valid] of [
    [undefined, true], [null, true], [0.05, true], [0.5, true], [0.95, true],
    [0.0499, false], [0.9501, false], [NaN, false], [Infinity, false], ['0.5', false],
  ] as const) {
    const dto = Object.assign(new CreateJobDto(), {
      url: 'https://example.com/video', mode: 'auto', captionStyle: { positionY },
    });
    const errors = validateSync(dto, { whitelist: true });
    assert.deepEqual(errors.map(({ property }) => property), valid ? [] : ['captionStyle'], `positionY=${String(positionY)}`);
  }
});

test('JobSnapshot and services carry captions', async () => {
  const snapshot = await readFile(join(root, 'apps/api/src/queue/job-events.service.ts'), 'utf8');
  assert.match(snapshot, /captions:\s*boolean;/);

  const listener = await readFile(join(root, 'apps/api/src/queue/queue.listener.ts'), 'utf8');
  assert.match(listener, /captions:\s*job\.captions,/);

  const service = await readFile(join(root, 'apps/api/src/jobs/jobs.service.ts'), 'utf8');
  assert.match(service, /const captions = dto\.captions \?\? true;/);
  assert.match(service, /captions,\s*\n\s*twoSpeakers,/);
});

test('worker parses captions default true and skips ASS when false', async () => {
  const models = await readFile(join(root, 'worker/clipper/models.py'), 'utf8');
  assert.match(models, /DEFAULT_CAPTIONS = True/);
  assert.match(models, /captions:\s*bool\s*=\s*DEFAULT_CAPTIONS/);
  assert.match(models, /"captions":\s*self\.captions,/);
  assert.match(models, /raw_captions = _first\(data, "captions", default=DEFAULT_CAPTIONS\)/);

  const pipeline = await readFile(join(root, 'worker/clipper/pipeline.py'), 'utf8');
  assert.match(pipeline, /clip_cues = _clip_cues\(cues, absolute_start, absolute_end\) if captions else \[\]/);
  assert.match(pipeline, /burn_ass = bool\(clip_cues\)/);
  assert.match(pipeline, /job\.captions,/);
});
