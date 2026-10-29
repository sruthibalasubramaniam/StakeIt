/**
 * Applies the structured-reading migration over the pooler connection.
 *
 * `prisma migrate deploy` hangs against Supabase's transaction pooler
 * (port 6543) — Prisma Migrate needs a direct/session connection. This script
 * runs the exact statements from the migration file through the query engine
 * (which works fine over the pooler) and records the migration in
 * `_prisma_migrations` so a later `migrate deploy` over a direct connection sees
 * it as already applied instead of replaying it.
 *
 * It is idempotent: statements that already exist are skipped by the
 * `_prisma_migrations` check, and every DDL statement is additive.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

// Folder name can be passed as argv[2]; defaults to the reading migration.
const MIGRATION = process.argv[2] || '20251026120000_structured_reading_lessons';
const prisma = new PrismaClient();

function statementsOf(sql) {
  return sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

(async () => {
  const file = path.join(__dirname, '..', 'prisma', 'migrations', MIGRATION, 'migration.sql');
  const raw = fs.readFileSync(file);
  const checksum = crypto.createHash('sha256').update(raw).digest('hex');
  const statements = statementsOf(raw.toString('utf8'));

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )
  `);

  const existing = await prisma.$queryRawUnsafe(
    'SELECT "migration_name", "finished_at" FROM "_prisma_migrations" WHERE "migration_name" = $1',
    MIGRATION,
  );

  if (existing.length > 0 && existing[0].finished_at) {
    console.log(`Already applied: ${MIGRATION}`);
    return;
  }

  let applied = 0;
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
    applied += 1;
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO "_prisma_migrations"
       ("id", "checksum", "finished_at", "migration_name", "started_at", "applied_steps_count")
     VALUES ($1, $2, now(), $3, now(), $4)`,
    crypto.randomUUID(),
    checksum,
    MIGRATION,
    statements.length,
  );

  const tables = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE 'reading_%'
      ORDER BY table_name`,
  );

  console.log(`Applied ${applied} statements for ${MIGRATION}`);
  console.log('Tables now present (reading):', tables.map((row) => row.table_name).join(', '));
})()
  .catch((error) => {
    console.error('MIGRATION FAILED:', String(error.message).slice(0, 500));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
