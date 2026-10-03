import { Router } from 'express';
import { Passport } from 'passport';
import { Strategy } from 'passport-local';
import { rateLimit } from 'express-rate-limit';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../db.js';
import { signupSchema } from '../lib/validation.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { csrf, requireUser } from '../middleware.js';

export async function createAuth(db: Database) {
  const passport = new Passport();
  const dummyHash = await hashPassword(randomBytes(32).toString('hex'));
  passport.use(
    new Strategy({ usernameField: 'email' }, async (email, password, done) => {
      try {
        const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
        const valid = await verifyPassword(password, user?.passwordHash || dummyHash);
        if (!user || !valid) return done(null, false);
        const { passwordHash: _passwordHash, ...safe } = user;
        done(null, safe);
      } catch (error) {
        done(error);
      }
    }),
  );
  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await db.user.findUnique({ where: { id }, omit: { passwordHash: true } });
      done(null, user || false);
    } catch (error) {
      done(error);
    }
  });
  const router = Router();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: 'Too many attempts. Please try again in 15 minutes.',
  });
  for (const page of ['login', 'signup']) {
    router.get(`/${page}`, (req, res) => {
      if (req.isAuthenticated()) return res.redirect('/app');
      res.render('auth', {
        page,
        title: page === 'login' ? 'Welcome back' : 'Create your account',
        error: null,
        values: {},
      });
    });
  }
  router.post('/signup', limiter, csrf, async (req, res, next) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).render('auth', {
        page: 'signup',
        title: 'Create your account',
        error: parsed.error.issues[0].message,
        values: req.body,
      });
    const { name, email, password } = parsed.data;
    if (await db.user.findUnique({ where: { email } }))
      return res.status(409).render('auth', {
        page: 'signup',
        title: 'Create your account',
        error: 'An account with this email already exists.',
        values: { name, email },
      });
    try {
      const user = await db.user.create({
        data: { name, email, passwordHash: await hashPassword(password) },
        omit: { passwordHash: true },
      });
      req.logIn(user, (error) => {
        if (error) return next(error);
        req.session.csrf = randomBytes(32).toString('hex');
        req.session.flash = { type: 'success', message: 'Welcome to Stow. Your space is ready.' };
        res.redirect('/app');
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002')
        return res.status(409).render('auth', {
          page: 'signup',
          title: 'Create your account',
          error: 'An account with this email already exists.',
          values: { name, email },
        });
      next(error);
    }
  });
  router.post('/login', limiter, csrf, (req, res, next) => {
    const parsed = z
      .object({ email: z.email().max(254), password: z.string().min(1).max(128) })
      .safeParse(req.body);
    if (!parsed.success)
      return res.status(400).render('auth', {
        page: 'login',
        title: 'Welcome back',
        error: 'Enter a valid email and password.',
        values: { email: req.body.email },
      });
    passport.authenticate('local', (error: Error | null, user: Express.User | false) => {
      if (error) return next(error);
      if (!user)
        return res.status(401).render('auth', {
          page: 'login',
          title: 'Welcome back',
          error: 'Email or password is incorrect.',
          values: { email: req.body.email },
        });
      req.logIn(user, (error) => {
        if (error) return next(error);
        req.session.csrf = randomBytes(32).toString('hex');
        res.redirect('/app');
      });
    })(req, res, next);
  });
  router.post('/logout', requireUser, csrf, (req, res, next) => {
    req.logout((error) => {
      if (error) return next(error);
      req.session.destroy((error) => {
        if (error) return next(error);
        res.clearCookie('stow.sid', { path: '/' });
        res.redirect('/login');
      });
    });
  });
  return { passport, router };
}
