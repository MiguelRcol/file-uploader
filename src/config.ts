import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_URL: z.url().default('http://localhost:3000'),
  DATABASE_URL: z.string().startsWith('file:').default('file:./data/stow.db'),
  SESSION_SECRET: z.string().min(32),
  STORAGE_PROVIDER: z.enum(['local', 'cloudinary']).default('local'),
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_FILE_SIZE_MB: z.coerce.number().int().min(1).max(25).default(10),
  USER_QUOTA_MB: z.coerce.number().int().min(1).max(1024).default(100),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
});

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const values = schema.parse(env);
  if (
    values.STORAGE_PROVIDER === 'cloudinary' &&
    (!values.CLOUDINARY_CLOUD_NAME || !values.CLOUDINARY_API_KEY || !values.CLOUDINARY_API_SECRET)
  ) {
    throw new Error(
      'Cloudinary storage requires CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.',
    );
  }
  if (
    values.NODE_ENV === 'production' &&
    (!values.APP_URL.startsWith('https://') || values.SESSION_SECRET.includes('replace-with'))
  ) {
    throw new Error('Production requires an HTTPS APP_URL and a unique session secret.');
  }
  return {
    ...values,
    databaseUrl: `file:${path.resolve(values.DATABASE_URL.slice(5)).replaceAll('\\', '/')}`,
    uploadDir: path.resolve(values.UPLOAD_DIR),
    maxFileBytes: values.MAX_FILE_SIZE_MB * 1024 * 1024,
    quotaBytes: values.USER_QUOTA_MB * 1024 * 1024,
    production: values.NODE_ENV === 'production',
  };
}
export type Config = ReturnType<typeof readConfig>;
