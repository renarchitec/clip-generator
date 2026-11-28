import assert from 'node:assert/strict';
import test from 'node:test';
import { DEMO_LIMITS } from '../../../../packages/shared/src/index.ts';
import { validateDemoJob, validateDemoPreview } from './demo-policy.ts';
import { escapeCsvCell } from '../admin/admin-helpers.ts';

test('demo preview allows youtube subtitle up to 120 minutes and defaults null maxSourceSec to 7200', () => {
  const res = validateDemoPreview({
    transcriptSource: 'youtube',
    maxSourceSec: null,
    targetDurationSec: 45,
    previewsUsed: 0,
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.data.effectiveMaxSourceSec, DEMO_LIMITS.maxSourceSec);
    assert.equal(res.data.effectiveMaxSourceSec, 7200);
  }
});

test('demo preview rejects non-youtube transcript sources', () => {
  for (const source of ['auto', 'live_chat_stt'] as const) {
    const res = validateDemoPreview({
      transcriptSource: source,
      maxSourceSec: 3600,
      targetDurationSec: 45,
      previewsUsed: 0,
    });
    assert.equal(res.ok, false);
  }
});

test('demo preview rejects source duration > 120 minutes, target > 60s, or exhausted preview quota', () => {
  assert.equal(
    validateDemoPreview({
      transcriptSource: 'youtube',
      maxSourceSec: 7201,
      targetDurationSec: 45,
      previewsUsed: 0,
    }).ok,
    false,
  );
  assert.equal(
    validateDemoPreview({
      transcriptSource: 'youtube',
      maxSourceSec: 7200,
      targetDurationSec: 61,
      previewsUsed: 0,
    }).ok,
    false,
  );
  assert.equal(
    validateDemoPreview({
      transcriptSource: 'youtube',
      maxSourceSec: 7200,
      targetDurationSec: 45,
      previewsUsed: DEMO_LIMITS.maxPreviewsTotal,
    }).ok,
    false,
  );
});

test('demo job enforces manual/review mode, youtube subtitle, 120m range bound, and clip/job quotas', () => {
  assert.equal(
    validateDemoJob({
      mode: 'manual',
      transcriptSource: 'youtube',
      targetDurationSec: 60,
      ranges: [
        { start: 100, end: 155 },
        { start: 7100, end: 7160 },
      ],
      jobsUsed: 0,
      activeJobs: 0,
      clipsUsed: 0,
    }).ok,
    true,
  );

  // Rejects direct auto mode
  assert.equal(
    validateDemoJob({
      mode: 'auto',
      transcriptSource: 'youtube',
      targetDurationSec: 45,
      ranges: [],
      jobsUsed: 0,
      activeJobs: 0,
      clipsUsed: 0,
    }).ok,
    false,
  );

  // Rejects range past 120 minutes
  assert.equal(
    validateDemoJob({
      mode: 'manual',
      transcriptSource: 'youtube',
      targetDurationSec: 45,
      ranges: [{ start: 7180, end: 7220 }],
      jobsUsed: 0,
      activeJobs: 0,
      clipsUsed: 0,
    }).ok,
    false,
  );

  // Rejects clips exceeding remaining total (3)
  assert.equal(
    validateDemoJob({
      mode: 'manual',
      transcriptSource: 'youtube',
      targetDurationSec: 45,
      ranges: [
        { start: 10, end: 55 },
        { start: 100, end: 145 },
      ],
      jobsUsed: 1,
      activeJobs: 0,
      clipsUsed: 2,
    }).ok,
    false,
  );

  // Rejects concurrent active job
  assert.equal(
    validateDemoJob({
      mode: 'manual',
      transcriptSource: 'youtube',
      targetDurationSec: 45,
      ranges: [{ start: 10, end: 55 }],
      jobsUsed: 0,
      activeJobs: 1,
      clipsUsed: 0,
    }).ok,
    false,
  );
});

test('escapeCsvCell neutralizes spreadsheet formulas and quotes commas/newlines', () => {
  assert.equal(escapeCsvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(escapeCsvCell('+123'), `'+123`);
  assert.equal(escapeCsvCell('hello, world'), '"hello, world"');
  assert.equal(escapeCsvCell(null), '');
});
