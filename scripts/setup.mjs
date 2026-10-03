import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import 'dotenv/config';
import Database from 'better-sqlite3';

try {
  await access('.env');
} catch {
  const template = await readFile('.env.example', 'utf8');
  await writeFile(
    '.env',
    template.replace(
      'replace-with-a-random-secret-of-at-least-32-characters',
      randomBytes(48).toString('hex'),
    ),
  );
  console.log('Created .env with a random session secret.');
}
const databasePath = path.resolve(
  (process.env.DATABASE_URL || 'file:./data/stow.db').replace(/^file:/, ''),
);
await mkdir(path.dirname(databasePath), { recursive: true });
new Database(databasePath).close();
await mkdir(process.env.UPLOAD_DIR || './uploads', { recursive: true });
for (const args of [['generate'], ['migrate', 'deploy']]) {
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], {
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Stow is ready. Run npm run dev and open http://localhost:3000.');
