import type { Database } from '../db.js';
import type { Config } from '../config.js';
import type { Storage } from '../storage.js';
import { HttpError } from '../lib/errors.js';
import { validateFile } from '../lib/validation.js';

export function descendants(folders: { id: string; parentId: string | null }[], root: string) {
  const ids = new Set([root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        changed = true;
      }
    }
  }
  return [...ids];
}

export function createLibrary(db: Database, storage: Storage, config: Config) {
  async function folder(ownerId: string, id: string) {
    const found = await db.folder.findFirst({ where: { id, ownerId } });
    if (!found) throw new HttpError(404, 'Folder not found.');
    return found;
  }
  async function file(ownerId: string, id: string) {
    const found = await db.file.findFirst({ where: { id, ownerId }, include: { folder: true } });
    if (!found) throw new HttpError(404, 'File not found.');
    return found;
  }
  return {
    folder,
    file,
    async upload(ownerId: string, folderId: string | null, incoming: Express.Multer.File) {
      if (folderId) await folder(ownerId, folderId);
      const validated = await validateFile(incoming);
      if (incoming.size > config.maxFileBytes)
        throw new HttpError(400, `Files must be ${config.MAX_FILE_SIZE_MB} MB or smaller.`);
      const user = await db.user.findUniqueOrThrow({ where: { id: ownerId } });
      if (user.usedBytes + incoming.size > config.quotaBytes)
        throw new HttpError(400, 'Your storage is full. Delete some files before uploading.');
      const stored = await storage.save(incoming.buffer, validated.extension);
      try {
        return await db.$transaction(async (tx) => {
          if (folderId && !(await tx.folder.findFirst({ where: { id: folderId, ownerId } })))
            throw new HttpError(404, 'Folder not found.');
          const reserved = await tx.user.updateMany({
            where: { id: ownerId, usedBytes: { lte: config.quotaBytes - incoming.size } },
            data: { usedBytes: { increment: incoming.size } },
          });
          if (!reserved.count)
            throw new HttpError(400, 'Your storage is full. Delete some files before uploading.');
          return tx.file.create({
            data: {
              name: validated.name,
              mimeType: validated.mimeType,
              size: incoming.size,
              ownerId,
              folderId,
              ...stored,
            },
          });
        });
      } catch (error) {
        await db.storageDeletion.create({
          data: { storageKey: stored.storageKey, provider: stored.provider },
        });
        throw error;
      }
    },
    async deleteFile(ownerId: string, id: string) {
      return db.$transaction(async (tx) => {
        const target = await tx.file.findFirst({ where: { id, ownerId } });
        if (!target) throw new HttpError(404, 'File not found.');
        await tx.storageDeletion.create({
          data: { storageKey: target.storageKey, provider: target.provider },
        });
        await tx.file.delete({ where: { id } });
        await tx.user.update({
          where: { id: ownerId },
          data: { usedBytes: { decrement: target.size } },
        });
        return target.folderId;
      });
    },
    async deleteFolder(ownerId: string, id: string) {
      return db.$transaction(async (tx) => {
        const target = await tx.folder.findFirst({ where: { id, ownerId } });
        if (!target) throw new HttpError(404, 'Folder not found.');
        const all = await tx.folder.findMany({
          where: { ownerId },
          select: { id: true, parentId: true },
        });
        const ids = descendants(all, id);
        const files = await tx.file.findMany({ where: { ownerId, folderId: { in: ids } } });
        if (files.length)
          await tx.storageDeletion.createMany({
            data: files.map(({ storageKey, provider }) => ({ storageKey, provider })),
          });
        await tx.folder.delete({ where: { id } });
        await tx.user.update({
          where: { id: ownerId },
          data: { usedBytes: { decrement: files.reduce((sum, item) => sum + item.size, 0) } },
        });
        return target.parentId;
      });
    },
    async shared(token: string) {
      const share = await db.share.findUnique({
        where: { token },
        include: { folder: { include: { owner: { select: { name: true } } } } },
      });
      if (!share || share.expiresAt <= new Date())
        throw new HttpError(404, 'This share link has expired or is no longer available.');
      const folders = await db.folder.findMany({
        where: { ownerId: share.folder.ownerId },
        select: { id: true, parentId: true, name: true, color: true },
      });
      const ids = descendants(folders, share.folderId);
      return { share, ids, folders: folders.filter((item) => ids.includes(item.id)) };
    },
  };
}
