import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Writable, Readable } from 'node:stream';
import {
  v2 as cloudinary,
  type UploadApiOptions,
  type UploadResponseCallback,
  type UploadApiResponse,
} from 'cloudinary';
import { readConfig } from '../src/config.js';
import { createStorage, createCleanup, type Storage } from '../src/storage.js';
import { createLibrary } from '../src/services/library.js';
import { createFixture } from './helpers.js';
import { hashPassword } from '../src/lib/password.js';

test('Cloudinary preserves bytes, uses authenticated raw uploads, and keeps signed URLs server-side', async () => {
  const config = readConfig({
    SESSION_SECRET: 'a-test-secret-with-more-than-32-characters',
    STORAGE_PROVIDER: 'cloudinary',
    CLOUDINARY_CLOUD_NAME: 'test-cloud',
    CLOUDINARY_API_KEY: '123456789',
    CLOUDINARY_API_SECRET: 'test-secret',
  });
  let uploaded: Buffer = Buffer.alloc(0);
  mock.method(
    cloudinary.uploader,
    'upload_stream',
    (options: UploadApiOptions, callback: UploadResponseCallback) => {
      assert.equal(options.resource_type, 'raw');
      assert.equal(options.type, 'authenticated');
      assert.equal(options.overwrite, false);
      return new Writable({
        write(chunk, _encoding, done) {
          uploaded = Buffer.concat([uploaded, chunk]);
          done();
        },
        final(done) {
          callback!(undefined, {
            public_id: options.public_id,
            secure_url: `https://res.cloudinary.com/test-cloud/raw/authenticated/${options.public_id}`,
          } as UploadApiResponse);
          done();
        },
      });
    },
  );
  mock.method(cloudinary.uploader, 'destroy', async (_key: string, options: UploadApiOptions) => {
    assert.equal(options.type, 'authenticated');
    assert.equal(options.resource_type, 'raw');
    return { result: 'ok' };
  });
  let fetched = '';
  mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    fetched = String(url);
    return new Response('original bytes');
  });
  try {
    const storage = createStorage(config);
    const stored = await storage.save(Buffer.from('original bytes'), '.txt');
    assert.equal(stored.provider, 'cloudinary');
    assert.match(stored.storageKey, /^stow\/[a-f0-9-]+\.txt$/);
    assert.equal(uploaded.toString(), 'original bytes');
    assert(stored.storageUrl?.startsWith('https://'));
    const stream = await storage.open(stored);
    const bytes = [];
    for await (const chunk of stream) bytes.push(Buffer.from(chunk));
    assert.equal(Buffer.concat(bytes).toString(), 'original bytes');
    assert.match(fetched, /\/raw\/authenticated\/s--[^/]+--\//);
    await storage.remove(stored);
  } finally {
    mock.restoreAll();
  }
});

test('Cloudinary upload and download failures propagate without returning a false success', async () => {
  const storage = createStorage(
    readConfig({
      SESSION_SECRET: 'a-test-secret-with-more-than-32-characters',
      STORAGE_PROVIDER: 'cloudinary',
      CLOUDINARY_CLOUD_NAME: 'test-cloud',
      CLOUDINARY_API_KEY: '123456789',
      CLOUDINARY_API_SECRET: 'test-secret',
    }),
  );
  mock.method(
    cloudinary.uploader,
    'upload_stream',
    (_options: UploadApiOptions, callback: UploadResponseCallback) =>
      new Writable({
        write(_chunk, _encoding, done) {
          callback!({ message: 'Provider unavailable', name: 'Error', http_code: 503 });
          done();
        },
      }),
  );
  mock.method(globalThis, 'fetch', async () => new Response('unavailable', { status: 503 }));
  try {
    await assert.rejects(storage.save(Buffer.from('bytes'), '.txt'));
    await assert.rejects(
      storage.open({ storageKey: 'stow/file.txt', provider: 'cloudinary' }),
      /download failed/,
    );
  } finally {
    mock.restoreAll();
  }
});

test('storage cleanup retains failed jobs and retries them successfully', async () => {
  const fixture = await createFixture();
  let calls = 0;
  const storage: Storage = {
    async save() {
      throw new Error('Not used');
    },
    async open() {
      return Readable.from([]);
    },
    async remove() {
      calls++;
      if (calls === 1) throw new Error('Temporary failure');
    },
  };
  const cleanup = createCleanup(fixture.db, storage);
  try {
    await fixture.db.storageDeletion.create({
      data: { provider: 'local', storageKey: 'a-file.txt' },
    });
    await cleanup();
    assert.equal(await fixture.db.storageDeletion.count(), 1);
    await cleanup();
    assert.equal(await fixture.db.storageDeletion.count(), 0);
    assert.equal(calls, 2);
  } finally {
    await fixture.dispose();
  }
});

test('a quota race rolls metadata back and queues the uploaded blob for cleanup', async () => {
  const fixture = await createFixture();
  try {
    const user = await fixture.db.user.create({
      data: {
        name: 'Alex',
        email: 'race@example.com',
        passwordHash: await hashPassword('a-test-password'),
      },
    });
    const storage: Storage = {
      async save() {
        await fixture.db.user.update({
          where: { id: user.id },
          data: { usedBytes: fixture.config.quotaBytes },
        });
        return { storageKey: 'race-file.txt', storageUrl: null, provider: 'local' };
      },
      async remove() {},
      async open() {
        return Readable.from([]);
      },
    };
    const library = createLibrary(fixture.db, storage, fixture.config);
    await assert.rejects(
      library.upload(user.id, null, {
        originalname: 'notes.txt',
        buffer: Buffer.from('hello'),
        size: 5,
      } as Express.Multer.File),
      /storage is full/,
    );
    assert.equal(await fixture.db.file.count(), 0);
    assert.equal(await fixture.db.storageDeletion.count(), 1);
    assert.equal(
      (await fixture.db.user.findUniqueOrThrow({ where: { id: user.id } })).usedBytes,
      fixture.config.quotaBytes,
    );
  } finally {
    await fixture.dispose();
  }
});
