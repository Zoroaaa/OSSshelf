import type { Context } from 'hono';

export interface Env {
  DB: D1Database;
  FILES?: R2Bucket;  // Legacy direct R2 binding — optional, use storageBuckets instead
  KV: KVNamespace;
  ENVIRONMENT: string;
  JWT_SECRET: string;
}

export type Variables = {
  userId?: string;
  user?: { id: string; email: string; role: string };
};

export type AppContext = Context<{ Bindings: Env; Variables: Variables }>;
