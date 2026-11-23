/**
 * Kontrak sanitasi caption/hashtag hasil LLM sebelum disimpan oleh listener.
 * Jalankan dari apps/api: node --experimental-strip-types src/queue/clip-social.spec.ts
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { sanitizeClipSocialMetadata } from './clip-social.ts';

test('caption di-trim, dibatasi 2200 karakter, dan kosong menjadi null', () => {
  assert.deepEqual(
    sanitizeClipSocialMetadata({ caption: '  Caption menarik\n' }),
    { caption: 'Caption menarik', hashtags: [] },
  );
  assert.equal(
    sanitizeClipSocialMetadata({ caption: `  ${'a'.repeat(2300)}  ` }).caption
      ?.length,
    2200,
  );
  assert.equal(sanitizeClipSocialMetadata({ caption: ' \n ' }).caption, null);
  assert.equal(sanitizeClipSocialMetadata({ caption: 123 }).caption, null);
});

test('hashtag dibersihkan, Unicode dipertahankan, dedupe, maksimal 15', () => {
  const result = sanitizeClipSocialMetadata({
    hashtags: [
      '#Podcast',
      'Podcast!',
      '# dua katak',
      '#边栏',
      '#一百',
      'angka_123',
      '###',
      42,
      null,
    ],
  });
  assert.deepEqual(result.hashtags, [
    'Podcast',
    'duakatak',
    '边栏',
    '一百',
    'angka_123',
  ]);

  const many = sanitizeClipSocialMetadata({
    hashtags: Array.from({ length: 20 }, (_, index) => `#topik${index}`),
  });
  assert.equal(many.hashtags.length, 15);
  assert.equal(many.hashtags[14], 'topik14');
});

test('input non-array aman dan QueueListener memakai sanitizer saat createMany', async () => {
  assert.deepEqual(sanitizeClipSocialMetadata({ hashtags: '#bukan-array' }), {
    caption: null,
    hashtags: [],
  });

  const listener = await readFile(
    join(process.cwd(), 'src/queue/queue.listener.ts'),
    'utf8',
  );
  assert.match(listener, /\.\.\.sanitizeClipSocialMetadata\(clip\)/);
  assert.match(listener, /tx\.clip\.createMany/);

  const jobs = await readFile(
    join(process.cwd(), 'src/jobs/jobs.service.ts'),
    'utf8',
  );
  const clips = await readFile(
    join(process.cwd(), 'src/clips/clips.service.ts'),
    'utf8',
  );
  assert.match(jobs, /caption: clip\.caption/);
  assert.match(jobs, /hashtags: clip\.hashtags/);
  assert.match(clips, /caption: true/);
  assert.match(clips, /hashtags: true/);
});
