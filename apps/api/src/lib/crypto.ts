/**
 * crypto.ts
 * 加密工具库
 * 
 * 功能:
 * - JWT令牌生成与验证
 * - 密码哈希与验证
 * - 存储凭证加密与解密
 * 
 * 兼容Cloudflare Workers运行时
 */

// ── JWT ──────────────────────────────────────────────────────────────────────

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  exp?: number;
  iat?: number;
}

function base64urlEncode(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(str: string): Uint8Array<ArrayBuffer> {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) {
    view[i] = raw.charCodeAt(i);
  }
  return view;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signJWT(payload: Omit<JWTPayload, 'iat' | 'exp'>, secret: string, expiresInSeconds = 7 * 24 * 3600): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JWTPayload = { ...payload, iat: now, exp: now + expiresInSeconds };

  const enc = new TextEncoder();
  const header = base64urlEncode(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = base64urlEncode(enc.encode(JSON.stringify(fullPayload)));
  const signingInput = `${header}.${body}`;

  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(signingInput));

  return `${signingInput}.${base64urlEncode(new Uint8Array(sig))}`;
}

export async function verifyJWT(token: string, secret: string): Promise<JWTPayload> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');

  const [header, body, signature] = parts;
  const enc = new TextEncoder();
  const signingInput = `${header}.${body}`;

  const key = await importHmacKey(secret);
  const valid = await crypto.subtle.verify('HMAC', key, base64urlDecode(signature), enc.encode(signingInput));
  if (!valid) throw new Error('Invalid token signature');

  const payload: JWTPayload = JSON.parse(new TextDecoder().decode(base64urlDecode(body)));

  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }

  return payload;
}

// ── Password hashing ─────────────────────────────────────────────────────────
// PBKDF2-SHA256 with 100k iterations – secure and Workers-compatible.

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;

export async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));

  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    256,
  );

  const hashArr = new Uint8Array(bits);
  const saltHex = [...salt].map((b) => b.toString(16).padStart(2, '0')).join('');
  const hashHex = [...hashArr].map((b) => b.toString(16).padStart(2, '0')).join('');

  return `pbkdf2:${PBKDF2_ITERATIONS}:${saltHex}:${hashHex}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

  const iterations = parseInt(parts[1], 10);
  const salt = new Uint8Array(parts[2].match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  const expectedHash = parts[3];

  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    256,
  );

  const actualHash = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return actualHash === expectedHash;
}
