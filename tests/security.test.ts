import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';
import { hashPassword, verifyPassword } from '../src/lib/password.js';
import { descendants } from '../src/services/library.js';

test('password verification uses unique salts and rejects an invalid password', async () => {
  const first = await hashPassword('ten-plus-characters');
  const second = await hashPassword('ten-plus-characters');
  assert.notEqual(first, second);
  assert(await verifyPassword('ten-plus-characters', first));
  assert(!(await verifyPassword('wrong-password', first)));
  assert(!(await verifyPassword('wrong-password', 'invalid')));
});
test('configuration rejects unsafe production defaults and incomplete cloud settings', () => {
  const base = { SESSION_SECRET: 'a-unique-secret-with-more-than-32-characters' };
  assert.throws(() => readConfig({ ...base, NODE_ENV: 'production' }), /HTTPS/);
  assert.throws(() => readConfig({ ...base, STORAGE_PROVIDER: 'cloudinary' }), /Cloudinary/);
  assert.throws(() => readConfig({ ...base, USER_QUOTA_MB: '2048' }));
  assert(
    readConfig({ ...base, NODE_ENV: 'production', APP_URL: 'https://example.com' }).production,
  );
});
test('descendant traversal terminates even with a malformed cycle and excludes unrelated folders', () => {
  assert.deepEqual(
    descendants(
      [
        { id: 'a', parentId: 'b' },
        { id: 'b', parentId: 'a' },
        { id: 'c', parentId: null },
      ],
      'a',
    ),
    ['a', 'b'],
  );
});
