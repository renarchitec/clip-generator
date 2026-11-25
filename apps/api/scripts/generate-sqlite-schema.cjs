#!/usr/bin/env node
/**
 * Generate prisma/schema.sqlite.prisma dan prisma/sqlite-init.sql dari prisma/schema.prisma.
 *
 * Sumber kebenaran tetap `prisma/schema.prisma` (PostgreSQL). Skema SQLite untuk
 * desktop hanya mengganti:
 * - datasource provider = "sqlite"
 * - generator output = "../node_modules/.prisma/sqlite-client" (client terpisah agar
 *   tidak bentrok dengan @prisma/client PostgreSQL)
 * - kolom String[] -> Json (karena SQLite tidak punya array primitif; Prisma menyimpan
 *   dan membaca kembali sebagai string[] di runtime).
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const apiRoot = path.resolve(__dirname, '..');
const pgSchemaPath = path.join(apiRoot, 'prisma', 'schema.prisma');
const sqliteSchemaPath = path.join(apiRoot, 'prisma', 'schema.sqlite.prisma');
const sqliteInitSqlPath = path.join(apiRoot, 'prisma', 'sqlite-init.sql');

const pgSchema = fs.readFileSync(pgSchemaPath, 'utf8');

const header = `// AUTO-GENERATED dari prisma/schema.prisma oleh scripts/generate-sqlite-schema.cjs.
// Jangan edit manual; ubah prisma/schema.prisma lalu jalankan \`pnpm --filter api prisma:sqlite:generate\`.

`;

const sqliteSchema =
  header +
  pgSchema
    .replace(
      /generator client \{\n/,
      'generator client {\n  output   = "../node_modules/.prisma/sqlite-client"\n',
    )
    .replace(/provider = "postgresql"/, 'provider = "sqlite"')
    .replace(/String\[\](\s+)@default\(\[\]\)/g, 'Json$1@default("[]")')
    .replace(/String\[\](\s*)$/gm, 'Json$1');

fs.writeFileSync(sqliteSchemaPath, sqliteSchema, 'utf8');

const prismaBin = path.join(apiRoot, 'node_modules', '.bin', 'prisma');
const rawSql = execFileSync(
  prismaBin,
  [
    'migrate',
    'diff',
    '--from-empty',
    '--to-schema-datamodel',
    sqliteSchemaPath,
    '--script',
  ],
  { cwd: apiRoot, encoding: 'utf8' },
);

const idempotentSql =
  '-- AUTO-GENERATED dari prisma/schema.sqlite.prisma oleh scripts/generate-sqlite-schema.cjs.\n' +
  'PRAGMA foreign_keys = ON;\n\n' +
  rawSql
    .replace(/^CREATE TABLE /gm, 'CREATE TABLE IF NOT EXISTS ')
    .replace(/^CREATE UNIQUE INDEX /gm, 'CREATE UNIQUE INDEX IF NOT EXISTS ')
    .replace(/^CREATE INDEX /gm, 'CREATE INDEX IF NOT EXISTS ');

fs.writeFileSync(sqliteInitSqlPath, idempotentSql, 'utf8');

if (!process.argv.includes('--no-client')) {
  execFileSync(prismaBin, ['generate', '--schema', sqliteSchemaPath], {
    cwd: apiRoot,
    stdio: 'inherit',
  });
}

console.log(`Generated ${path.relative(apiRoot, sqliteSchemaPath)} & ${path.relative(apiRoot, sqliteInitSqlPath)}`);
