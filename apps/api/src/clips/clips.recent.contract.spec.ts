import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), '../..');

test('ClipsService.recent: scoped ke user + job done, urut terbaru, limit 1..24', async () => {
  const serviceCode = await readFile(join(root, 'apps/api/src/clips/clips.service.ts'), 'utf8');
  const controllerCode = await readFile(join(root, 'apps/api/src/clips/clips.controller.ts'), 'utf8');

  // hanya clip hidup dari job done milik user
  assert.match(serviceCode, /where:\s*\{\s*deletedAt:\s*null,\s*job:\s*\{\s*userId,\s*status:\s*JobStatus\.done\s*\}\s*\}/);
  assert.match(serviceCode, /orderBy:\s*\{\s*createdAt:\s*'desc'\s*\}/);

  // limit di-clamp 1..24, default 8
  assert.match(serviceCode, /Math\.min\(Math\.max\(Math\.trunc\(limit\) \|\| 8, 1\), 24\)/);

  // rute recent terdaftar sebelum rute :id
  assert.match(controllerCode, /@Get\('recent'\)[\s\S]*@Get\(':id\/stream'\)/);
  assert.match(controllerCode, /@CurrentUser\(\) user: \{ id: string \}/);
});
