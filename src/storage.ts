import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { v2 as cloudinary } from 'cloudinary';
import type { Config } from './config.js';
import type { Database } from './db.js';

export interface StoredObject {
  storageKey: string;
  storageUrl: string | null;
  provider: string;
}
export interface Storage {
  save(buffer: Buffer, extension: string): Promise<StoredObject>;
  remove(object: Pick<StoredObject, 'storageKey' | 'provider'>): Promise<void>;
  open(object: Pick<StoredObject, 'storageKey' | 'provider'>): Promise<Readable>;
}

export function createStorage(config: Config): Storage {
  cloudinary.config({
    cloud_name: config.CLOUDINARY_CLOUD_NAME,
    api_key: config.CLOUDINARY_API_KEY,
    api_secret: config.CLOUDINARY_API_SECRET,
    secure: true,
  });
  function localPath(key: string) {
    if (!/^[a-f0-9-]+\.[a-z]+$/.test(key)) throw new Error('Invalid storage key.');
    return path.join(config.uploadDir, key);
  }
  return {
    async save(buffer, extension) {
      const id = `${randomUUID()}${extension}`;
      if (config.STORAGE_PROVIDER === 'local') {
        await mkdir(config.uploadDir, { recursive: true });
        await writeFile(localPath(id), buffer, { flag: 'wx' });
        return { storageKey: id, storageUrl: null, provider: 'local' };
      }
      return new Promise((resolve, reject) => {
        const upload = cloudinary.uploader.upload_stream(
          {
            public_id: `stow/${id}`,
            resource_type: 'raw',
            type: 'authenticated',
            overwrite: false,
            timeout: 60000,
          },
          (error, result) => {
            if (error || !result) return reject(error || new Error('Upload failed.'));
            resolve({
              storageKey: result.public_id,
              storageUrl: result.secure_url,
              provider: 'cloudinary',
            });
          },
        );
        upload.end(buffer);
      });
    },
    async remove(object) {
      if (object.provider === 'local') {
        await unlink(localPath(object.storageKey)).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
      } else {
        const result = await cloudinary.uploader.destroy(object.storageKey, {
          resource_type: 'raw',
          type: 'authenticated',
          invalidate: true,
        });
        if (!['ok', 'not found'].includes(result.result))
          throw new Error('Cloud storage deletion failed.');
      }
    },
    async open(object) {
      if (object.provider === 'local') return createReadStream(localPath(object.storageKey));
      const url = cloudinary.url(object.storageKey, {
        resource_type: 'raw',
        type: 'authenticated',
        sign_url: true,
        secure: true,
      });
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok || !response.body) throw new Error('Cloud storage download failed.');
      return Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    },
  };
}

export function createCleanup(db: Database, storage: Storage) {
  let running = false;
  return async function cleanup() {
    if (running) return;
    running = true;
    try {
      const jobs = await db.storageDeletion.findMany({ orderBy: { createdAt: 'asc' }, take: 50 });
      for (const job of jobs) {
        try {
          await storage.remove(job);
          await db.storageDeletion.delete({ where: { id: job.id } });
        } catch {
          console.error('A storage deletion will be retried.');
        }
      }
    } finally {
      running = false;
    }
  };
}
