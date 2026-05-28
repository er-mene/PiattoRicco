import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not configured');
}

const isAccelerateUrl =
  databaseUrl.startsWith('prisma://') || databaseUrl.startsWith('prisma+postgres://');

const prisma = isAccelerateUrl
  ? new PrismaClient({ accelerateUrl: databaseUrl })
  : new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

export default prisma;
