import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { HttpError } from './lib/errors.js';

export function wantsJson(req: Request) {
  return req.get('accept')?.includes('application/json') || req.get('x-requested-with') === 'fetch';
}
export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) return next();
  if (wantsJson(req)) return res.status(401).json({ error: 'Sign in to continue.' });
  res.redirect('/login');
}
export function csrfLocals(req: Request, res: Response, next: NextFunction) {
  req.session.csrf ||= randomBytes(32).toString('hex');
  res.locals.csrf = req.session.csrf;
  res.locals.user = req.user;
  res.locals.flash = req.session.flash;
  delete req.session.flash;
  next();
}
export function csrf(req: Request, _res: Response, next: NextFunction) {
  const supplied = req.get('x-csrf-token') || req.body?._csrf;
  const expected = req.session.csrf;
  if (
    typeof supplied !== 'string' ||
    !/^[a-f0-9]{64}$/.test(supplied) ||
    !expected ||
    supplied.length !== expected.length ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  ) {
    return next(new HttpError(403, 'Your form has expired. Reload the page and try again.'));
  }
  next();
}
