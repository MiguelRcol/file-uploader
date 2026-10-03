import type { User as DatabaseUser } from './generated/prisma/client.js';

declare global {
  namespace Express {
    interface User extends Omit<DatabaseUser, 'passwordHash'> {}
  }
}
declare module 'express-session' {
  interface SessionData {
    csrf?: string;
    flash?: { type: 'success' | 'error'; message: string };
  }
}
