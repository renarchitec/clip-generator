/**
 * Kontrak regenerasi caption: rute, antrean `captions`, sanitasi hasil worker.
 * Jalankan dari apps/api: node --experimental-strip-types src/clips/clips.caption.contract.spec.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseCaptionResult,
  sanitizeClipTranscript,
} from '../queue/clip-social.ts';

const root = join(process.cwd(), '../..');
const read = (path: string) => readFile(join(root, path), 'utf8');

test('antrean captions sama di shared, API, dan worker', async () => {
  const shared = await read('packages/shared/src/index.ts');
  const constants = await read('apps/api/src/queue/queue.constants.ts');
  const models = await read('worker/clipper/models.py');
  const worker = await read('worker/clipper/worker.py');
  assert.match(shared, /CAPTION_QUEUE_NAME = 'captions'/);
  assert.match(constants, /CAPTION_QUEUE_NAME = 'captions'/);
  assert.match(constants, /CAPTION_WAIT_TIMEOUT_MS = 60_000/);
  assert.match(models, /CAPTION_QUEUE_NAME = "captions"/);
  assert.match(worker, /CAPTION_CONCURRENCY = 2/);
  assert.match(worker, /CAPTION_QUEUE_NAME,\s*\n\s*_handle_caption,/);
});

test('rute POST clips/:id/caption owner-scoped dengan DTO IsIn CAPTION_LANGUAGES', async () => {
  const controller = await read('apps/api/src/clips/clips.controller.ts');
  assert.match(controller, /@Post\(':id\/caption'\)\s*\n\s*@HttpCode\(200\)/);
  assert.match(controller, /@Body\(\) dto: RegenerateCaptionDto/);
  assert.match(controller, /this\.captions\.regenerate\(id, dto\.language, user\.id\)/);

  const dto = await read('apps/api/src/clips/dto/regenerate-caption.dto.ts');
  assert.match(dto, /@IsIn\(CAPTION_LANGUAGES\)\s*\n\s*language: CaptionLanguage;/);
});

test('service: 404 klip asing/terhapus, antre + tunggu 60s, 503 caption_unavailable, persist', async () => {
  const service = await read('apps/api/src/clips/clip-captions.service.ts');
  assert.match(service, /where: \{ id, deletedAt: null, job: \{ userId \} \}/);
  assert.match(service, /NotFoundException/);
  assert.match(service, /removeOnComplete: true,/);
  assert.match(service, /removeOnFail: true,/);
  assert.match(service, /waitUntilFinished\(this\.events, CAPTION_WAIT_TIMEOUT_MS\)/);
  assert.match(
    service,
    /new ServiceUnavailableException\(\{ message: 'caption_unavailable' \}\)/,
  );
  assert.match(service, /transcript: clip\.transcript \?\? null,/);
  assert.match(service, /currentCaption: clip\.caption \?\? null,/);
  assert.match(service, /description: clip\.job\.description \?\? null,/);
  assert.match(service, /data: \{ caption: result\.caption, hashtags: result\.hashtags \}/);

  const shared = await read('packages/shared/src/index.ts');
  assert.match(shared, /export interface CaptionJobData/);
  assert.match(shared, /export interface CaptionJobResult/);
  assert.match(shared, /export interface RegenerateCaptionRequest/);
});

test('parseCaptionResult memakai sanitizer clip-social', () => {
  assert.deepEqual(
    parseCaptionResult({ caption: '  Hook baru ', hashtags: ['#Viral', 'viral', 'a b', 5] }),
    { caption: 'Hook baru', hashtags: ['Viral', 'viral', 'ab'] },
  );
  assert.deepEqual(parseCaptionResult('{"caption":"x","hashtags":[]}'), {
    caption: 'x',
    hashtags: [],
  });
  assert.equal(parseCaptionResult({ caption: '   ' }), null);
  assert.equal(parseCaptionResult('bukan json'), null);
  assert.equal(parseCaptionResult(null), null);
  assert.equal(parseCaptionResult({ caption: 'a'.repeat(3000) })?.caption.length, 2200);
});

test('sanitizeClipTranscript: trim, maksimal 2000, kosong -> null', () => {
  assert.equal(sanitizeClipTranscript('  halo  '), 'halo');
  assert.equal(sanitizeClipTranscript('x'.repeat(2500))?.length, 2000);
  assert.equal(sanitizeClipTranscript('   '), null);
  assert.equal(sanitizeClipTranscript(undefined), null);
  assert.equal(sanitizeClipTranscript(42), null);
});
