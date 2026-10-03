import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import { HttpError } from './errors.js';

export const colors = ['sage', 'lavender', 'peach', 'blue', 'yellow'] as const;
export const nameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(120, 'Use 120 characters or fewer.')
  .refine(
    (value) => !/[\\/\x00-\x1f\x7f]/.test(value),
    'Names cannot contain slashes or control characters.',
  );
export const signupSchema = z.object({
  name: z.string().trim().min(2, 'Enter at least two characters for your name.').max(60),
  email: z
    .email('Enter a valid email address.')
    .max(254)
    .transform((value) => value.toLowerCase()),
  password: z.string().min(10, 'Use at least 10 characters for your password.').max(128),
});
export const folderSchema = z.object({ name: nameSchema, color: z.enum(colors).default('sage') });
export const allowedExtensions = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.txt', '.md', '.csv'];
const binaryTypes: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};
const textTypes: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
};

export async function validateFile(file: Express.Multer.File) {
  const name = nameSchema.parse(file.originalname.normalize('NFC'));
  const extension = path.extname(name).toLowerCase();
  if (!allowedExtensions.includes(extension))
    throw new HttpError(400, 'Choose a PDF, PNG, JPG, WebP, TXT, Markdown, or CSV file.');
  if (!file.size) throw new HttpError(400, 'Empty files cannot be uploaded.');
  let mimeType = binaryTypes[extension];
  if (mimeType) {
    const detected = await fileTypeFromBuffer(file.buffer).catch(() => undefined);
    if (detected?.mime !== mimeType)
      throw new HttpError(400, 'The file content does not match its extension.');
  } else {
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(decoded)) throw new Error('Binary content');
    } catch {
      throw new HttpError(400, 'Text files must contain valid UTF-8 text.');
    }
    mimeType = textTypes[extension];
  }
  return { name, mimeType, extension };
}
