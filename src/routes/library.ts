import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import type { Config } from '../config.js';
import type { Database } from '../db.js';
import type { Storage } from '../storage.js';
import type { createLibrary } from '../services/library.js';
import { csrf, requireUser, wantsJson } from '../middleware.js';
import { folderSchema, nameSchema } from '../lib/validation.js';
import { HttpError } from '../lib/errors.js';
import type { Prisma } from '../generated/prisma/client.js';

type Library = ReturnType<typeof createLibrary>;
const scalar = (value: unknown) => (typeof value === 'string' ? value : '');
const destination = (folderId: string | null) =>
  folderId ? `/app?folder=${encodeURIComponent(folderId)}` : '/app';

export function createLibraryRouter(
  db: Database,
  library: Library,
  storage: Storage,
  config: Config,
  cleanup: () => Promise<void>,
) {
  const router = Router();
  router.use(requireUser);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use(async (req, res, next) => {
    const ownerId = req.user!.id;
    const [user, totalFiles, totalFolders, activeShares, allFolders] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { id: ownerId }, omit: { passwordHash: true } }),
      db.file.count({ where: { ownerId } }),
      db.folder.count({ where: { ownerId } }),
      db.share.count({ where: { folder: { ownerId }, expiresAt: { gt: new Date() } } }),
      db.folder.findMany({
        where: { ownerId },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, parentId: true, color: true },
      }),
    ]);
    res.locals.user = user;
    res.locals.stats = { totalFiles, totalFolders, activeShares };
    res.locals.allFolders = allFolders
      .map((folder) => {
        const parts = [folder.name];
        let parentId = folder.parentId;
        const seen = new Set([folder.id]);
        while (parentId && !seen.has(parentId)) {
          seen.add(parentId);
          const parent = allFolders.find((item) => item.id === parentId);
          if (!parent) break;
          parts.unshift(parent.name);
          parentId = parent.parentId;
        }
        return { ...folder, path: parts.join(' / ') };
      })
      .sort((a, b) => a.path.localeCompare(b.path));
    res.locals.config = config;
    next();
  });
  router.get('/app', async (req, res) => {
    const ownerId = req.user!.id;
    const folderId = scalar(req.query.folder) || null;
    const currentFolder = folderId ? await library.folder(ownerId, folderId) : null;
    const q = scalar(req.query.q).trim().slice(0, 120);
    const view = ['recent', 'starred', 'images', 'documents'].includes(scalar(req.query.view))
      ? scalar(req.query.view)
      : 'all';
    const sort = ['name', 'size', 'oldest'].includes(scalar(req.query.sort))
      ? scalar(req.query.sort)
      : 'newest';
    const where: Prisma.FileWhereInput = { ownerId };
    if (q) where.name = { contains: q };
    else if (view === 'all') where.folderId = folderId;
    if (view === 'starred') where.starred = true;
    if (view === 'images') where.mimeType = { startsWith: 'image/' };
    if (view === 'documents') where.NOT = { mimeType: { startsWith: 'image/' } };
    const count = await db.file.count({ where });
    const pages = Math.max(1, Math.ceil(count / 24));
    const page = Math.min(pages, Math.max(1, Number.parseInt(scalar(req.query.page), 10) || 1));
    const files = await db.file.findMany({
      where,
      orderBy:
        sort === 'name'
          ? { name: 'asc' }
          : sort === 'size'
            ? { size: 'desc' }
            : { createdAt: sort === 'oldest' ? 'asc' : 'desc' },
      skip: (page - 1) * 24,
      take: 24,
      include: { folder: true },
    });
    const folders =
      view === 'all'
        ? await db.folder.findMany({
            where: { ownerId, ...(q ? { name: { contains: q } } : { parentId: folderId }) },
            include: {
              _count: { select: { files: true, children: true } },
              shares: { where: { expiresAt: { gt: new Date() } }, select: { id: true } },
            },
            orderBy: { name: 'asc' },
          })
        : [];
    const breadcrumbs: { id: string; name: string }[] = [];
    let ancestor = currentFolder;
    while (ancestor) {
      breadcrumbs.unshift({ id: ancestor.id, name: ancestor.name });
      ancestor = ancestor.parentId ? await library.folder(ownerId, ancestor.parentId) : null;
    }
    const titles: Record<string, string> = {
      all: 'My files',
      recent: 'Recent files',
      starred: 'Starred files',
      images: 'Images',
      documents: 'Documents',
    };
    res.render('library', {
      title: q ? 'Search results' : currentFolder?.name || titles[view],
      view,
      q,
      sort,
      currentFolder,
      folderId,
      folders,
      files,
      breadcrumbs,
      page,
      pages,
      count,
    });
  });
  router.get('/files/:id', async (req, res) => {
    const file = await library.file(req.user!.id, scalar(req.params.id));
    res.render('file', { title: file.name, file, view: 'all', q: '' });
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxFileBytes, files: 1, fields: 3, fieldSize: 1024, parts: 5 },
  });
  const uploadLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  router.post(
    '/files/upload',
    uploadLimiter,
    (req, res, next) => (req.get('x-csrf-token') ? csrf(req, res, next) : next()),
    upload.single('file'),
    csrf,
    async (req, res) => {
      if (!req.file) throw new HttpError(400, 'Choose a file to upload.');
      const folderId = scalar(req.body.folderId) || null;
      const file = await library.upload(req.user!.id, folderId, req.file);
      if (wantsJson(req)) return res.status(201).json({ id: file.id, name: file.name });
      req.session.flash = { type: 'success', message: `${file.name} uploaded.` };
      res.redirect(destination(folderId));
    },
  );
  router.get('/files/:id/download', async (req, res) => {
    const file = await library.file(req.user!.id, scalar(req.params.id));
    const stream = await storage.open(file);
    res.attachment(file.name).type(file.mimeType).set('Content-Length', String(file.size));
    await pipeline(stream, res);
  });
  router.get('/files/:id/preview', async (req, res) => {
    const file = await library.file(req.user!.id, scalar(req.params.id));
    if (!file.mimeType.startsWith('image/'))
      throw new HttpError(400, 'Preview is available for images.');
    const stream = await storage.open(file);
    res.type(file.mimeType).set('Content-Length', String(file.size));
    await pipeline(stream, res);
  });
  router.post('/files/:id/star', csrf, async (req, res) => {
    const target = await library.file(req.user!.id, scalar(req.params.id));
    const file = await db.file.update({
      where: { id: target.id },
      data: { starred: !target.starred },
    });
    if (wantsJson(req)) return res.json({ starred: file.starred });
    res.redirect(`/files/${file.id}`);
  });
  router.post('/files/:id/rename', csrf, async (req, res) => {
    const target = await library.file(req.user!.id, scalar(req.params.id));
    const name = nameSchema.parse(req.body.name);
    const extension = target.name.slice(target.name.lastIndexOf('.')).toLowerCase();
    if (!name.toLowerCase().endsWith(extension))
      throw new HttpError(400, `Keep the ${extension} extension when renaming this file.`);
    await db.file.update({ where: { id: target.id }, data: { name } });
    req.session.flash = { type: 'success', message: 'File renamed.' };
    res.redirect(`/files/${target.id}`);
  });
  router.post('/files/:id/move', csrf, async (req, res) => {
    const target = await library.file(req.user!.id, scalar(req.params.id));
    const folderId = scalar(req.body.folderId) || null;
    if (folderId) await library.folder(req.user!.id, folderId);
    await db.file.update({ where: { id: target.id }, data: { folderId } });
    req.session.flash = { type: 'success', message: 'File moved.' };
    res.redirect(destination(folderId));
  });
  router.post('/files/:id/delete', csrf, async (req, res) => {
    const folderId = await library.deleteFile(req.user!.id, scalar(req.params.id));
    void cleanup().catch(() => console.error('Storage cleanup will be retried.'));
    req.session.flash = { type: 'success', message: 'File deleted.' };
    res.redirect(destination(folderId));
  });
  router.post('/folders', csrf, async (req, res) => {
    const data = folderSchema.parse(req.body);
    const parentId = scalar(req.body.parentId) || null;
    if (parentId) await library.folder(req.user!.id, parentId);
    if ((await db.folder.count({ where: { ownerId: req.user!.id } })) >= 500)
      throw new HttpError(400, 'You can create up to 500 folders.');
    await db.folder.create({ data: { ...data, parentId, ownerId: req.user!.id } });
    req.session.flash = { type: 'success', message: 'Folder created.' };
    res.redirect(destination(parentId));
  });
  router.post('/folders/:id/rename', csrf, async (req, res) => {
    const target = await library.folder(req.user!.id, scalar(req.params.id));
    await db.folder.update({ where: { id: target.id }, data: folderSchema.parse(req.body) });
    req.session.flash = { type: 'success', message: 'Folder updated.' };
    res.redirect(destination(target.id));
  });
  router.post('/folders/:id/delete', csrf, async (req, res) => {
    const parentId = await library.deleteFolder(req.user!.id, scalar(req.params.id));
    void cleanup().catch(() => console.error('Storage cleanup will be retried.'));
    req.session.flash = { type: 'success', message: 'Folder and its contents deleted.' };
    res.redirect(destination(parentId));
  });
  router.post('/folders/:id/share', csrf, async (req, res) => {
    const target = await library.folder(req.user!.id, scalar(req.params.id));
    const days = z.coerce.number().int().min(1).max(30).parse(req.body.days);
    if ((await db.share.count({ where: { folderId: target.id } })) >= 20)
      throw new HttpError(400, 'Remove an old link before creating another.');
    await db.share.create({
      data: {
        folderId: target.id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + days * 86400000),
      },
    });
    req.session.flash = {
      type: 'success',
      message:
        'Share link created. Anyone with the link can view and download this folder until it expires.',
    };
    res.redirect('/shares');
  });
  router.get('/shares', async (req, res) => {
    const shares = await db.share.findMany({
      where: { folder: { ownerId: req.user!.id } },
      include: { folder: true },
      orderBy: { createdAt: 'desc' },
    });
    res.render('shares', { title: 'Shared folders', shares, view: 'shared', q: '' });
  });
  router.post('/shares/:id/revoke', csrf, async (req, res) => {
    const result = await db.share.deleteMany({
      where: { id: scalar(req.params.id), folder: { ownerId: req.user!.id } },
    });
    if (!result.count) throw new HttpError(404, 'Share link not found.');
    req.session.flash = { type: 'success', message: 'Share link revoked.' };
    res.redirect('/shares');
  });
  return router;
}

export function createShareRouter(db: Database, library: Library, storage: Storage) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
    });
    next();
  });
  router.get('/share/:token', async (req, res) => {
    const { share, ids, folders } = await library.shared(scalar(req.params.token));
    const folderId = scalar(req.query.folder) || share.folderId;
    if (!ids.includes(folderId)) throw new HttpError(404, 'Folder not found.');
    const currentFolder = folders.find((item) => item.id === folderId)!;
    const files = await db.file.findMany({
      where: { folderId, ownerId: share.folder.ownerId },
      orderBy: { name: 'asc' },
    });
    const breadcrumbs: { id: string; name: string }[] = [];
    let current: typeof currentFolder | undefined = currentFolder;
    while (current) {
      breadcrumbs.unshift(current);
      current =
        current.id === share.folderId
          ? undefined
          : folders.find((item) => item.id === current!.parentId);
    }
    res.render('share', {
      title: share.folder.name,
      share,
      currentFolder,
      breadcrumbs,
      folders: folders.filter((item) => item.parentId === folderId),
      files,
    });
  });
  router.get('/share/:token/files/:id/download', async (req, res) => {
    const { share, ids } = await library.shared(scalar(req.params.token));
    const file = await db.file.findFirst({
      where: { id: scalar(req.params.id), ownerId: share.folder.ownerId, folderId: { in: ids } },
    });
    if (!file) throw new HttpError(404, 'File not found.');
    const stream = await storage.open(file);
    res.attachment(file.name).type(file.mimeType).set('Content-Length', String(file.size));
    await pipeline(stream, res);
  });
  return router;
}
