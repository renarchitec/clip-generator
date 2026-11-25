/**
 * Kontrak hashtag kustom: shared, migrasi, DTO, service/retry, snapshot, regenerasi caption, worker.
 * Jalankan dari apps/api: node --experimental-strip-types src/jobs/jobs.custom-hashtags.contract.spec.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CUSTOM_HASHTAGS_MAX,
  CUSTOM_HASHTAG_MAX_LENGTH,
  normalizeCustomHashtags,
} from '../../../../packages/shared/src/index.ts';

const root = join(process.cwd(), '../..');
const read = (path: string) => readFile(join(root, path), 'utf8');

test('normalizeCustomHashtags: pecah, bersihkan, dedupe case-insensitive, batasi', () => {
  assert.equal(CUSTOM_HASHTAGS_MAX, 15);
  assert.equal(CUSTOM_HASHTAG_MAX_LENGTH, 50);
  assert.deepEqual(normalizeCustomHashtags('#Viral, #viral  fyp_id #Tag!'), ['Viral', 'fyp_id', 'Tag']);
  assert.deepEqual(normalizeCustomHashtags(['#A b', 'a', 5, null, '##', '边栏']), ['A', 'b', '边栏']);
  assert.deepEqual(normalizeCustomHashtags(null), []);
  assert.deepEqual(normalizeCustomHashtags(undefined), []);
  assert.deepEqual(normalizeCustomHashtags(42), []);
  assert.deepEqual(normalizeCustomHashtags('   '), []);
  assert.equal(normalizeCustomHashtags('a'.repeat(80))[0].length, 50);
  const many = normalizeCustomHashtags(Array.from({ length: 30 }, (_, index) => `t${index}`));
  assert.equal(many.length, 15);
  assert.equal(many[14], 't14');
});

test('shared mengekspor konstanta, normalizer, dan field JobData/CaptionJobData', async () => {
  const shared = await read('packages/shared/src/index.ts');
  assert.match(shared, /export const CUSTOM_HASHTAGS_MAX = 15;/);
  assert.match(shared, /export const CUSTOM_HASHTAG_MAX_LENGTH = 50;/);
  assert.match(shared, /export function normalizeCustomHashtags\(raw: unknown\): string\[\]/);
  assert.equal((shared.match(/customHashtags\?: string\[\];/g) ?? []).length, 2);
});

test('schema + migrasi 20260130000000_custom_hashtags', async () => {
  const schema = await read('apps/api/prisma/schema.prisma');
  assert.match(schema, /customHashtags\s+String\[\]\s+@default\(\[\]\)/);

  const migration = await read(
    'apps/api/prisma/migrations/20260130000000_custom_hashtags/migration.sql',
  );
  assert.match(
    migration,
    /ALTER TABLE "jobs" ADD COLUMN "customHashtags" TEXT\[\] NOT NULL DEFAULT ARRAY\[\]::TEXT\[\];/,
  );
});

test('CreateJobDto: customHashtags opsional dengan validator IsCustomHashtags', async () => {
  const dto = await read('apps/api/src/jobs/dto/create-job.dto.ts');
  assert.match(dto, /@IsCustomHashtags\(\)\s*\n\s*customHashtags\?: string\[\] \| string \| null;/);
  assert.match(dto, /export function IsCustomHashtags/);
  assert.match(dto, /value\.length <= 500/);
  assert.match(dto, /value\.length <= 30/);
  assert.match(dto, /item\.length <= 100/);
});

test('service menormalisasi, menyimpan, mengantrekan, dan retry mempertahankan customHashtags', async () => {
  const service = await read('apps/api/src/jobs/jobs.service.ts');
  assert.match(service, /const customHashtags = normalizeCustomHashtags\(dto\.customHashtags\);/);
  // Disimpan di Job dan dikirim di JobData.
  assert.equal((service.match(/\n\s+customHashtags,\n/g) ?? []).length, 2);
  assert.match(service, /dto\.customHashtags = old\.customHashtags;/);
  assert.match(service, /customHashtags: job\.customHashtags,/);

  const snapshot = await read('apps/api/src/queue/job-events.service.ts');
  assert.match(snapshot, /customHashtags\?: string\[\];/);
  const listener = await read('apps/api/src/queue/queue.listener.ts');
  assert.match(listener, /customHashtags: job\.customHashtags,/);
});

test('regenerasi caption mengirim customHashtags ke worker dan menimpa hashtag hasil', async () => {
  const service = await read('apps/api/src/clips/clip-captions.service.ts');
  assert.match(service, /job: \{ select: \{ description: true, customHashtags: true \} \}/);
  assert.match(service, /const customHashtags = normalizeCustomHashtags\(clip\.job\.customHashtags\);/);
  assert.match(service, /\n\s+customHashtags,\n/);
  assert.match(
    service,
    /if \(result && customHashtags\.length > 0\) \{\s*\n\s*result = \{ caption: result\.caption, hashtags: customHashtags \};/,
  );
});

test('worker membaca customHashtags dan tidak membuat hashtag otomatis', async () => {
  const models = await read('worker/clipper/models.py');
  assert.match(models, /CUSTOM_HASHTAGS_MAX = 15/);
  assert.match(models, /CUSTOM_HASHTAG_MAX_LENGTH = 50/);
  assert.match(models, /"customHashtags": list\(self\.custom_hashtags\),/);
  assert.match(models, /custom_hashtags=to_custom_hashtags\(_first\(data, "customHashtags", "custom_hashtags"\)\),/);

  const llm = await read('worker/clipper/llm.py');
  assert.match(llm, /JANGAN buat hashtag otomatis/);
  assert.match(llm, /def _strip_inline_hashtags\(text: str\) -> str:/);
  assert.match(llm, /custom_hashtags: List\[str\] = field\(default_factory=list\)/);

  const pipeline = await read('worker/clipper/pipeline.py');
  assert.match(pipeline, /job\.caption_language,\s*\n\s*job\.custom_hashtags,/);
});

test('spec masuk skrip test api', async () => {
  const pkg = await read('apps/api/package.json');
  assert.match(pkg, /jobs\.custom-hashtags\.contract\.spec\.ts/);
});
