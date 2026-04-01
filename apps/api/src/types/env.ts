import type { Context } from 'hono';

export interface Env {
  DB: D1Database;
  FILES?: R2Bucket;
  KV: KVNamespace;
  AI?: Ai;
  VECTORIZE?: VectorizeIndex;
  ENVIRONMENT: string;
  JWT_SECRET: string;
  PUBLIC_URL?: string;
  CORS_ORIGINS?: string;
}

export type Variables = {
  userId?: string;
  user?: { id: string; email: string; role: string };
  authType?: 'jwt' | 'apiKey';
  apiKeyId?: string;
  apiKeyScopes?: string[];
};

export type AppContext = Context<{ Bindings: Env; Variables: Variables }>;
