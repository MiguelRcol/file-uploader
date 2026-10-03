import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from './generated/prisma/client.js';

export function createDatabase(url: string) {
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
}
export type Database = ReturnType<typeof createDatabase>;
