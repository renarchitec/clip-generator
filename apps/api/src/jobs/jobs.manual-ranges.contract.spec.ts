import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), '../..');

test('shared exports ManualRange with optional title and reason', async () => {
  const shared = await readFile(join(root, 'packages/shared/src/index.ts'), 'utf8');
  assert.match(shared, /title\?:\s*string;/);
  assert.match(shared, /reason\?:\s*string;/);
});

test('ManualRangeDto validates optional string max title 70 and reason 200', async () => {
  const dto = await readFile(join(root, 'apps/api/src/jobs/dto/create-job.dto.ts'), 'utf8');
  assert.match(dto, /@MaxLength\(70\)\s*\n\s*title\?: string;/);
  assert.match(dto, /@MaxLength\(200\)\s*\n\s*reason\?: string;/);
});

test('jobs.service normalizeRanges preserves sanitized title and reason', async () => {
  const service = await readFile(join(root, 'apps/api/src/jobs/jobs.service.ts'), 'utf8');
  assert.match(service, /sanitizeMomentText\(range\.title,\s*70\)/);
  assert.match(service, /sanitizeMomentText\(range\.reason,\s*200\)/);
  assert.match(service, /if \(title\) normalized\.title = title;/);
  assert.match(service, /if \(reason\) normalized\.reason = reason;/);
});

test('worker models parses and serializes title and reason on ManualRange', async () => {
  const models = await readFile(join(root, 'worker/clipper/models.py'), 'utf8');
  assert.match(models, /title:\s*Optional\[str\]\s*=\s*None/);
  assert.match(models, /reason:\s*Optional\[str\]\s*=\s*None/);
  assert.match(models, /payload\["title"\] = self\.title/);
  assert.match(models, /payload\["reason"\] = self\.reason/);
  assert.match(models, /title=_to_text\(data\.get\("title"\),\s*MAX_RANGE_TITLE_CHARS\)/);
  assert.match(models, /reason=_to_text\(data\.get\("reason"\),\s*MAX_RANGE_REASON_CHARS\)/);
});

test('worker pipeline preserves title and reason with timestamp fallback', async () => {
  const pipeline = await readFile(join(root, 'worker/clipper/pipeline.py'), 'utf8');
  assert.match(pipeline, /title = \(item\.title or ""\)\.strip\(\)/);
  assert.match(pipeline, /reason = \(item\.reason or ""\)\.strip\(\)/);
  assert.match(pipeline, /title\[:70\] or llm\.title_from_cues\(cues, item\.start, item\.end\)/);
  assert.match(pipeline, /reason\[:200\] or "manual"/);
});

test('web route sends candidate title and reason while cue ranges omit them', async () => {
  const web = await readFile(join(root, 'apps/web/src/routes/index.tsx'), 'utf8');
  assert.match(web, /title:\s*candidates\[index\]\.title/);
  assert.match(web, /reason:\s*candidates\[index\]\.reason/);
});
