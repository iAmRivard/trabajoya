import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(rootDir, 'migrations');

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
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();

  for (const file of files) {
    const migration = await readFile(join(migrationsDir, file), 'utf8');
    await pool.query(migration);
    console.log(`Migracion aplicada: ${file}`);
  }
} finally {
  await pool.end();
}
