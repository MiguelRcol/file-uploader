import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import supertest from 'supertest';
import { createFixture, register, token } from './helpers.js';

let fixture: Awaited<ReturnType<typeof createFixture>>;
let alice: Awaited<ReturnType<typeof register>>;
let bob: Awaited<ReturnType<typeof register>>;
let aliceId: string;
let rootId: string;
let childId: string;
let uploadedId: string;
let rootFileId: string;
let shareToken: string;

before(async () => {
  fixture = await createFixture();
  alice = await register(fixture.app, 'alice@example.com');
  bob = await register(fixture.app, 'bob@example.com', 'Sam Ellis');
  aliceId = (await fixture.db.user.findUniqueOrThrow({ where: { email: alice.email } })).id;
});
after(async () => {
  if (fixture) await fixture.dispose();
});

test('landing, app, and health render; private routes require authentication', async () => {
  await supertest(fixture.app)
    .get('/')
    .expect(200)
    .expect(/A little space/);
  await supertest(fixture.app).get('/health').expect(200, { status: 'ok', service: 'stow' });
  await supertest(fixture.app).get('/app').expect(302).expect('Location', '/login');
  await supertest(fixture.app)
    .get('/files/unknown/download')
    .set('Accept', 'application/json')
    .expect(401);
});
test('passwords are hashed and sessions are persisted with secure cookie attributes', async () => {
  const user = await fixture.db.user.findUniqueOrThrow({ where: { id: aliceId } });
  assert.match(user.passwordHash, /^scrypt:/);
  assert(!user.passwordHash.includes('A-strong-password'));
  const sessions = await fixture.db.session.findMany();
  assert(sessions.some((session) => JSON.parse(session.data).passport?.user === aliceId));
  const response = await supertest(fixture.app).get('/login');
  assert.match(response.headers['set-cookie'][0], /HttpOnly/);
  assert.match(response.headers['set-cookie'][0], /SameSite=Lax/);
});
test('CSRF rejects missing, malformed, and non-ASCII tokens', async () => {
  for (const supplied of ['', 'x'.repeat(64), 'é'.repeat(64)]) {
    await alice.agent
      .post('/folders')
      .type('form')
      .send({ _csrf: supplied, name: 'Blocked' })
      .expect(403);
  }
  assert.equal(await fixture.db.folder.count(), 0);
});
test('authentication rejects bad credentials and duplicate accounts', async () => {
  const agent = supertest.agent(fixture.app);
  const response = await agent.get('/login');
  await agent
    .post('/login')
    .type('form')
    .send({ _csrf: token(response.text), email: alice.email, password: 'incorrect-password' })
    .expect(401)
    .expect(/Email or password is incorrect/);
  await agent
    .post('/signup')
    .type('form')
    .send({
      _csrf: token(response.text),
      name: 'Another Alex',
      email: alice.email,
      password: 'A-strong-password-2026',
    })
    .expect(409);
});
test('folders can be created, nested, renamed, and recolored', async () => {
  await alice.agent
    .post('/folders')
    .type('form')
    .send({ _csrf: alice.csrf, name: 'Projects', color: 'sage' })
    .expect(302);
  rootId = (
    await fixture.db.folder.findFirstOrThrow({ where: { ownerId: aliceId, name: 'Projects' } })
  ).id;
  await alice.agent
    .post('/folders')
    .type('form')
    .send({ _csrf: alice.csrf, name: 'Drafts', parentId: rootId, color: 'peach' })
    .expect(302);
  childId = (
    await fixture.db.folder.findFirstOrThrow({ where: { ownerId: aliceId, name: 'Drafts' } })
  ).id;
  await alice.agent
    .post(`/folders/${rootId}/rename`)
    .type('form')
    .send({ _csrf: alice.csrf, name: 'Portfolio', color: 'lavender' })
    .expect(302);
  await alice.agent
    .get(`/app?folder=${childId}`)
    .expect(200)
    .expect(/Portfolio/)
    .expect(/Drafts/);
  assert.equal(
    (await fixture.db.folder.findUniqueOrThrow({ where: { id: rootId } })).color,
    'lavender',
  );
});
test('ownership checks protect folders and file destinations', async () => {
  await bob.agent.get(`/app?folder=${rootId}`).expect(404);
  await bob.agent
    .post(`/folders/${rootId}/rename`)
    .type('form')
    .send({ _csrf: bob.csrf, name: 'Hijacked' })
    .expect(404);
  await bob.agent
    .post(`/folders/${rootId}/delete`)
    .type('form')
    .send({ _csrf: bob.csrf })
    .expect(404);
  await bob.agent
    .post('/folders')
    .type('form')
    .send({ _csrf: bob.csrf, name: 'Sneaky', parentId: rootId })
    .expect(404);
  await bob.agent
    .post('/files/upload')
    .set('Accept', 'application/json')
    .set('x-csrf-token', bob.csrf)
    .field('folderId', rootId)
    .attach('file', Buffer.from('hello'), 'hello.txt')
    .expect(404);
});
test('uploads validate contents, write bytes privately, and reserve quota', async () => {
  const response = await alice.agent
    .post('/files/upload')
    .set('Accept', 'application/json')
    .set('x-csrf-token', alice.csrf)
    .field('folderId', childId)
    .attach('file', Buffer.from('An original draft.\n'), 'brief.md')
    .expect(201);
  uploadedId = response.body.id;
  const file = await fixture.db.file.findUniqueOrThrow({ where: { id: uploadedId } });
  assert.equal(file.mimeType, 'text/markdown');
  assert.equal(
    await readFile(path.join(fixture.config.uploadDir, file.storageKey), 'utf8'),
    'An original draft.\n',
  );
  assert.equal(
    (await fixture.db.user.findUniqueOrThrow({ where: { id: aliceId } })).usedBytes,
    file.size,
  );
  await supertest(fixture.app).get(`/uploads/${file.storageKey}`).expect(302);
  await alice.agent
    .get(`/files/${uploadedId}`)
    .expect(200)
    .expect(/brief.md/);
});
test('invalid extensions, signatures, binary text, empty files, and oversize files fail without records', async () => {
  const beforeCount = await fixture.db.file.count();
  const cases = [
    { name: 'evil.html', bytes: Buffer.from('<script>alert(1)</script>') },
    { name: 'fake.png', bytes: Buffer.from('not an image') },
    { name: 'tiny.png', bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    { name: 'binary.txt', bytes: Buffer.from([0, 1, 255]) },
    { name: 'empty.txt', bytes: Buffer.alloc(0) },
    { name: 'large.txt', bytes: Buffer.alloc(1024 * 1024 + 1, 65) },
  ];
  for (const item of cases)
    await alice.agent
      .post('/files/upload')
      .set('Accept', 'application/json')
      .set('x-csrf-token', alice.csrf)
      .attach('file', item.bytes, item.name)
      .expect(400);
  assert.equal(await fixture.db.file.count(), beforeCount);
});
test('a valid PNG can be previewed while documents cannot', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=',
    'base64',
  );
  const response = await alice.agent
    .post('/files/upload')
    .set('Accept', 'application/json')
    .set('x-csrf-token', alice.csrf)
    .attach('file', png, 'pixel.png')
    .expect(201);
  rootFileId = response.body.id;
  await alice.agent
    .get(`/files/${rootFileId}/preview`)
    .expect(200)
    .expect('Content-Type', /image\/png/);
  await alice.agent.get(`/files/${uploadedId}/preview`).expect(400);
});
test('foreign users cannot read, download, preview, star, rename, move, or delete a file', async () => {
  for (const route of ['', '/download', '/preview'])
    await bob.agent.get(`/files/${uploadedId}${route}`).expect(404);
  for (const route of ['star', 'rename', 'move', 'delete'])
    await bob.agent
      .post(`/files/${uploadedId}/${route}`)
      .type('form')
      .send({ _csrf: bob.csrf, name: 'stolen.md', folderId: rootId })
      .expect(404);
});
test('file downloads preserve content and use an attachment disposition', async () => {
  const response = await alice.agent.get(`/files/${uploadedId}/download`).expect(200);
  assert.match(response.headers['content-disposition'], /attachment; filename="brief.md"/);
  assert.equal(response.text, 'An original draft.\n');
});
test('star, rename, move, search, and file filters work', async () => {
  await alice.agent
    .post(`/files/${uploadedId}/star`)
    .set('Accept', 'application/json')
    .set('x-csrf-token', alice.csrf)
    .expect(200, { starred: true });
  await alice.agent
    .get('/app?view=starred')
    .expect(200)
    .expect(/brief.md/);
  await alice.agent
    .post(`/files/${uploadedId}/rename`)
    .type('form')
    .send({ _csrf: alice.csrf, name: 'renamed.md' })
    .expect(302);
  await alice.agent
    .post(`/files/${uploadedId}/rename`)
    .type('form')
    .send({ _csrf: alice.csrf, name: 'wrong.png' })
    .expect(400);
  await alice.agent
    .post(`/files/${uploadedId}/move`)
    .type('form')
    .send({ _csrf: alice.csrf, folderId: rootId })
    .expect(302);
  await alice.agent
    .get('/app?q=renamed')
    .expect(200)
    .expect(/renamed.md/);
  const images = await alice.agent.get('/app?view=images').expect(200);
  assert(images.text.includes('pixel.png'));
  assert(!images.text.includes('renamed.md'));
  await alice.agent
    .post(`/files/${uploadedId}/move`)
    .type('form')
    .send({ _csrf: alice.csrf, folderId: childId })
    .expect(302);
});
test('expiring folder links include descendants and restrict outsiders to the shared tree', async () => {
  await alice.agent
    .post(`/folders/${rootId}/share`)
    .type('form')
    .send({ _csrf: alice.csrf, days: 10 })
    .expect(302);
  const share = await fixture.db.share.findFirstOrThrow({ where: { folderId: rootId } });
  shareToken = share.token;
  assert(share.expiresAt.getTime() > Date.now() + 9 * 86400000);
  await supertest(fixture.app)
    .get(`/share/${shareToken}`)
    .expect(200)
    .expect(/Drafts/);
  await supertest(fixture.app)
    .get(`/share/${shareToken}?folder=${childId}`)
    .expect(200)
    .expect(/renamed.md/);
  await supertest(fixture.app).get(`/share/${shareToken}/files/${uploadedId}/download`).expect(200);
  await supertest(fixture.app).get(`/share/${shareToken}/files/${rootFileId}/download`).expect(404);
  await supertest(fixture.app).get(`/share/${shareToken}?folder=outside`).expect(404);
  await bob.agent
    .post(`/shares/${share.id}/revoke`)
    .type('form')
    .send({ _csrf: bob.csrf })
    .expect(404);
});
test('sharing validates duration; expiry and revocation immediately deny downloads', async () => {
  for (const days of [0, 31, 1.5, 'bad'])
    await alice.agent
      .post(`/folders/${rootId}/share`)
      .type('form')
      .send({ _csrf: alice.csrf, days })
      .expect(400);
  const share = await fixture.db.share.findUniqueOrThrow({ where: { token: shareToken } });
  await fixture.db.share.update({ where: { id: share.id }, data: { expiresAt: new Date(0) } });
  await supertest(fixture.app).get(`/share/${shareToken}`).expect(404);
  await supertest(fixture.app).get(`/share/${shareToken}/files/${uploadedId}/download`).expect(404);
  await alice.agent
    .get('/shares')
    .expect(200)
    .expect(/Expired/);
  await alice.agent
    .post(`/shares/${share.id}/revoke`)
    .type('form')
    .send({ _csrf: alice.csrf })
    .expect(302);
  assert.equal(await fixture.db.share.count(), 0);
});
test('quota checks reject uploads even if the individual file size is allowed', async () => {
  const used = (await fixture.db.user.findUniqueOrThrow({ where: { id: aliceId } })).usedBytes;
  await fixture.db.user.update({
    where: { id: aliceId },
    data: { usedBytes: fixture.config.quotaBytes - 2 },
  });
  const response = await alice.agent
    .post('/files/upload')
    .set('Accept', 'application/json')
    .set('x-csrf-token', alice.csrf)
    .attach('file', Buffer.from('over quota'), 'quota.txt')
    .expect(400);
  assert.match(response.body.error, /storage is full/);
  await fixture.db.user.update({ where: { id: aliceId }, data: { usedBytes: used } });
});
test('untrusted names are escaped when rendered', async () => {
  await alice.agent
    .post('/folders')
    .type('form')
    .send({ _csrf: alice.csrf, name: '<img src=x onerror=alert(1)>' })
    .expect(302);
  const response = await alice.agent.get('/app');
  assert(response.text.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert(!response.text.includes('<img src=x onerror=alert(1)>'));
});
test('recursive folder deletion removes metadata and shares, reclaims quota, and queues blob cleanup', async () => {
  await alice.agent
    .post(`/folders/${rootId}/share`)
    .type('form')
    .send({ _csrf: alice.csrf, days: 1 })
    .expect(302);
  const removed = await fixture.db.file.findUniqueOrThrow({ where: { id: uploadedId } });
  await alice.agent
    .post(`/folders/${rootId}/delete`)
    .type('form')
    .send({ _csrf: alice.csrf })
    .expect(302);
  await fixture.cleanup();
  assert.equal(await fixture.db.folder.count({ where: { id: { in: [rootId, childId] } } }), 0);
  assert.equal(await fixture.db.file.count({ where: { id: uploadedId } }), 0);
  assert.equal(await fixture.db.share.count(), 0);
  assert.equal(
    (await fixture.db.user.findUniqueOrThrow({ where: { id: aliceId } })).usedBytes,
    (await fixture.db.file.findUniqueOrThrow({ where: { id: rootFileId } })).size,
  );
  // The HTTP handler may already be draining the queue; wait for that one deletion.
  for (let i = 0; i < 20; i++) {
    try {
      await access(path.join(fixture.config.uploadDir, removed.storageKey));
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail('Deleted file remained on disk.');
});
test('individual deletion reclaims the remaining quota', async () => {
  await alice.agent
    .post(`/files/${rootFileId}/delete`)
    .type('form')
    .send({ _csrf: alice.csrf })
    .expect(302);
  assert.equal((await fixture.db.user.findUniqueOrThrow({ where: { id: aliceId } })).usedBytes, 0);
});
test('logout invalidates the database session and requires a new login', async () => {
  await alice.agent.post('/logout').type('form').send({ _csrf: alice.csrf }).expect(302);
  await alice.agent.get('/app').expect(302);
  const persisted = await fixture.db.session.findMany();
  assert(!persisted.some((session) => JSON.parse(session.data).passport?.user === aliceId));
});
