import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import multer from 'multer';
import path from 'node:path';
import { ZodError } from 'zod';
import { PrismaSessionStore } from '@quixo3/prisma-session-store';
import { createDatabase } from './db.js';
import type { Config } from './config.js';
import { createStorage, createCleanup } from './storage.js';
import type { Storage } from './storage.js';
import { createLibrary } from './services/library.js';
import { createAuth } from './routes/auth.js';
import { createLibraryRouter, createShareRouter } from './routes/library.js';
import { csrfLocals, wantsJson } from './middleware.js';
import { HttpError } from './lib/errors.js';
import { formatDate, formatSize, fileKind } from './lib/presentation.js';

export async function createApp(config: Config, providedStorage?: Storage) {
  const db = createDatabase(config.databaseUrl);
  const storage = providedStorage || createStorage(config);
  const cleanup = createCleanup(db, storage);
  const library = createLibrary(db, storage, config);
  const { passport, router: auth } = await createAuth(db);
  const app = express();
  app.disable('x-powered-by');
  if (config.TRUST_PROXY === 'true') app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', path.resolve('views'));
  app.locals = { ...app.locals, formatDate, formatSize, fileKind };
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'script-src': ["'self'"],
          'style-src': ["'self'"],
          'img-src': ["'self'", 'data:'],
          'form-action': ["'self'"],
          'connect-src': ["'self'"],
          'upgrade-insecure-requests': config.production ? [] : null,
        },
      },
      strictTransportSecurity: config.production ? undefined : false,
    }),
  );
  app.use(
    '/assets',
    express.static(path.resolve('public'), { maxAge: config.production ? '1h' : 0 }),
  );
  app.get('/health', async (_req, res) => {
    try {
      await db.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', service: 'stow' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  const store = new PrismaSessionStore(db, {
    checkPeriod: config.NODE_ENV === 'test' ? 0 : 120000,
    dbRecordIdIsSessionId: true,
    logger: false,
  });
  app.use(
    session({
      name: 'stow.sid',
      secret: config.SESSION_SECRET,
      store,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, secure: config.production, sameSite: 'lax', maxAge: 7 * 86400000 },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());
  app.use(csrfLocals);
  app.get('/', (req, res) =>
    req.isAuthenticated()
      ? res.redirect('/app')
      : res.render('landing', { title: 'A little space for everything' }),
  );
  app.use(auth);
  app.use(createShareRouter(db, library, storage));
  app.use(createLibraryRouter(db, library, storage, config, cleanup));
  app.use((_req, _res, next) => next(new HttpError(404, 'This page could not be found.')));
  app.use(
    (error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (res.headersSent) return next(error);
      let status = error instanceof HttpError ? error.status : 500;
      let message = status === 500 ? 'Something went wrong. Please try again.' : error.message;
      if (error instanceof ZodError) {
        status = 400;
        message = error.issues[0].message;
      }
      if (error instanceof multer.MulterError) {
        status = 400;
        message =
          error.code === 'LIMIT_FILE_SIZE'
            ? `Files must be ${config.MAX_FILE_SIZE_MB} MB or smaller.`
            : 'Upload one file at a time, within the allowed limits.';
      }
      if ('status' in error && error.status === 413) {
        status = 413;
        message = 'This request is too large.';
      }
      if (status === 500) console.error('Request failed:', error.message);
      if (wantsJson(req)) return res.status(status).json({ error: message });
      res.status(status).render('error', {
        title: status === 404 ? 'Nothing here' : 'Unable to continue',
        status,
        message,
      });
    },
  );
  const cleanupTimer =
    config.NODE_ENV === 'test'
      ? undefined
      : setInterval(() => {
          void cleanup().catch(() => console.error('Storage cleanup will be retried.'));
        }, 60000).unref();
  return {
    app,
    db,
    storage,
    library,
    cleanup,
    async close() {
      if (cleanupTimer) clearInterval(cleanupTimer);
      store.stopInterval();
      await db.$disconnect();
    },
  };
}
