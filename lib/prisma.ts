import { PrismaClient } from "@prisma/client";

// En desarrollo, Next recarga los módulos en cada cambio. Sin esto se abre una
// conexión nueva por recarga y se agota el pool.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
