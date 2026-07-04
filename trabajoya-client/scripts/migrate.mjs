import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const migration = await readFile(join(rootDir, 'migrations/001_candidate_intakes.sql'), 'utf8');

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PGHOST || '127.0.0.1',
        port: Number(process.env.PGPORT || 15432),
        database: process.env.PGDATABASE || 'trabajoya',
        user: process.env.PGUSER || 'trabajoya_dbeaver',
        password: process.env.PGPASSWORD,
      },
);

try {
  await pool.query(migration);
  console.log('Migracion aplicada: candidate_intakes');
} finally {
  await pool.end();
}
