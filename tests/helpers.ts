import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import SQLite from 'better-sqlite3';
import { readConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import supertest from 'supertest';

export async function createFixture() {
  const root = path.resolve('data');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'test-'));
  const dbPath = path.join(directory, 'test.db');
  new SQLite(dbPath).close();
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: `file:${dbPath.replaceAll('\\', '/')}` },
    stdio: 'pipe',
  });
  const config = readConfig({
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:3000',
    SESSION_SECRET: 'a-test-secret-with-more-than-32-characters',
    DATABASE_URL: `file:${dbPath}`,
    UPLOAD_DIR: path.join(directory, 'uploads'),
    USER_QUOTA_MB: '1',
    MAX_FILE_SIZE_MB: '1',
  });
  const runtime = await createApp(config);
  return {
    ...runtime,
    config,
    async dispose() {
      await runtime.close();
      const relative = path.relative(root, directory);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
        throw new Error('Invalid test directory.');
      await rm(directory, { recursive: true, force: true });
    },
  };
}
export function token(html: string) {
  const result = html.match(/name="csrf-token" content="([a-f0-9]+)"/);
  if (!result) throw new Error('Missing CSRF token.');
  return result[1];
}
export async function register(
  app: Parameters<typeof supertest>[0],
  email: string,
  name = 'Alex Morgan',
) {
  const agent = supertest.agent(app);
  const signup = await agent.get('/signup').expect(200);
  await agent
    .post('/signup')
    .type('form')
    .send({ _csrf: token(signup.text), name, email, password: 'A-strong-password-2026' })
    .expect(302);
  const home = await agent.get('/app').expect(200);
  return { agent, csrf: token(home.text), email };
}
