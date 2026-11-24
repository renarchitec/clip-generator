/**
 * Kontrak riwayat brief: model Prisma + migrasi, service record/list/remove,
 * endpoint BriefsController, dan integrasi best-effort di JobsService.
 * Jalankan: node --experimental-strip-types src/briefs/brief-history.contract.spec.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), '../..');
const read = (path: string) => readFile(join(root, path), 'utf8');

test('model BriefHistory dan relasi User', async () => {
  const schema = await read('apps/api/prisma/schema.prisma');
  assert.match(
    schema,
    /model BriefHistory \{\s*id\s+String\s+@id\s+@default\(uuid\(\)\)\s*userId\s+String\s*user\s+User\s+@relation\(fields: \[userId\], references: \[id\], onDelete: Cascade\)[^]*?text\s+String[^]*?useCount\s+Int\s+@default\(1\)\s*createdAt\s+DateTime\s+@default\(now\(\)\)\s*lastUsedAt\s+DateTime\s+@default\(now\(\)\)[^]*?@@unique\(\[userId, text\]\)\s*@@index\(\[userId, lastUsedAt\]\)\s*@@map\("brief_history"\)/,
  );
  assert.match(schema, /model User \{[^]*?briefHistory\s+BriefHistory\[\]/);

  const migration = await read(
    'apps/api/prisma/migrations/20260128000000_brief_history/migration.sql',
  );
  assert.match(migration, /CREATE TABLE "brief_history"/);
  assert.match(migration, /"useCount" INTEGER NOT NULL DEFAULT 1/);
  assert.match(migration, /"lastUsedAt" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  assert.match(migration, /CREATE INDEX "brief_history_userId_lastUsedAt_idx" ON "brief_history"\("userId", "lastUsedAt"\)/);
  assert.match(migration, /CREATE UNIQUE INDEX "brief_history_userId_text_key" ON "brief_history"\("userId", "text"\)/);
  assert.match(migration, /ON DELETE CASCADE/);
});

test('service trim, upsert hitungan, dan batas 30 entri per user', async () => {
  const service = await read('apps/api/src/briefs/brief-history.service.ts');
  assert.match(service, /const HISTORY_LIMIT = 30;/);
  assert.match(service, /const trimmed = text\.trim\(\);/);
  assert.match(service, /if \(!trimmed\) return null;/);
  assert.match(service, /briefHistory\.upsert\(\{/);
  assert.match(service, /where: \{ userId_text: \{ userId, text: trimmed \} \}/);
  assert.match(service, /useCount: \{ increment: 1 \}/);
  assert.match(service, /lastUsedAt: new Date\(\)/);
  assert.match(service, /skip: HISTORY_LIMIT/);
  assert.match(service, /briefHistory\.deleteMany\(\{/);
  assert.match(service, /NotFoundException/);
});

test('endpoint GET/POST/DELETE history terautentikasi dengan DTO validasi', async () => {
  const controller = await read('apps/api/src/briefs/briefs.controller.ts');
  assert.match(controller, /@Controller\('briefs'\)/);
  assert.match(controller, /@Get\('history'\)/);
  assert.match(controller, /@Post\('history'\)/);
  assert.match(controller, /@Delete\('history\/:id'\)/);
  assert.match(controller, /@HttpCode\(204\)/);
  assert.match(controller, /@Body\(\) dto: CreateBriefHistoryDto/);
  assert.match(controller, /@Param\('id'\) id: string/);
  assert.equal(
    (controller.match(/@CurrentUser\(\)/g) ?? []).length >= 4,
    true,
  );
  const dto = await read('apps/api/src/briefs/dto/create-brief-history.dto.ts');
  assert.match(dto, /@IsString\(\)/);
  assert.match(dto, /@Length\(2, 500\)/);
  const module = await read('apps/api/src/briefs/briefs.module.ts');
  assert.match(module, /BriefHistoryService/);
  assert.match(module, /exports: \[BriefsService, BriefHistoryService\]/);
});

test('JobsService merekam deskripsi best-effort setelah job dibuat', async () => {
  const service = await read('apps/api/src/jobs/jobs.service.ts');
  assert.match(service, /if \(description\) \{[\s\S]*?this\.briefHistory\.record\(userId, description\)/);
  assert.match(service, /catch \(error\) \{[\s\S]*?logger\.warn\(/);
  const module = await read('apps/api/src/jobs/jobs.module.ts');
  assert.match(module, /imports: \[[^\]]*BriefsModule[^\]]*\]/);
});
