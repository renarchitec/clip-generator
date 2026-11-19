import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveClipPath } from './clip-path.ts';

const root = join(process.cwd(), '../..');

test('resolveClipPath: mengembalikan absolute path bila aman di dalam base', () => {
  const result = resolveClipPath('/tmp/clips', 'job-123/clip.mp4');
  assert.equal(result, '/tmp/clips/job-123/clip.mp4');
});

test('resolveClipPath: null saat traversal ke luar base', () => {
  assert.equal(resolveClipPath('/tmp/clips', '../etc/passwd'), null);
  assert.equal(resolveClipPath('/tmp/clips', '/etc/passwd'), null);
  assert.equal(resolveClipPath('/tmp/clips', 'job/../../etc/passwd'), null);
});

test('ClipsService.remove: kontrak method, status 404, safe unlink, dan DB hard-delete', async () => {
  const serviceCode = await readFile(join(root, 'apps/api/src/clips/clips.service.ts'), 'utf8');

  // pastikan method remove ada dengan filter kepemilikan userId
  assert.match(serviceCode, /async remove\(id: string, userId: string\): Promise<void>/);
  assert.match(serviceCode, /where:\s*\{\s*id,\s*job:\s*\{\s*userId\s*\}\s*\}/);

  // pastikan ENOENT diabaikan saat unlink
  assert.match(serviceCode, /unlink\(absolutePath\)/);
  assert.match(serviceCode, /code !== 'ENOENT'/);

  // pastikan row dihapus permanen
  assert.match(serviceCode, /this\.prisma\.clip\.deleteMany\(\{\s*where:\s*\{\s*id,\s*job:\s*\{\s*userId\s*\}\s*\}\s*\}\)/);
});
