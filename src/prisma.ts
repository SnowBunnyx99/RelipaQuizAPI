import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "./env.js";

// Prisma 7 connects through a driver adapter instead of a built-in engine.
const adapter = new PrismaPg(env.DATABASE_URL);

export const prisma = new PrismaClient({ adapter });
