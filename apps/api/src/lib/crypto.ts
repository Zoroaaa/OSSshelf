/**
 * crypto.ts
 * 加密工具库
 *
 * 功能:
 * - JWT令牌生成与验证
 * - 密码哈希与验证
 * - 存储凭证加密与解密（AES-GCM）
 *
 * 兼容Cloudflare Workers运行时
 */

// ── Credential Encryption (AES-GCM) ─────────────────────────────────────────
const AES_KEY_LENGTH = 256;
const IV_LENGTH = 12;
const TAG_LENGTH = 128;

async function importAesKey(keyMaterial: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyData = await crypto.subtle.digest('SHA-256', enc.encode(keyMaterial));
  return crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM', length: AES_KEY_LENGTH }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptCredential(plaintext: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await importAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: TAG_LENGTH },
    key,
    enc.encode(plaintext)
  );

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return btoa(String.fromCharCode(...combined));
}

export async function decryptCredential(encrypted: string, secret: string): Promise<string> {
  const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);

  const key = await importAesKey(secret);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: TAG_LENGTH }, key, ciphertext);

  return new TextDecoder().decode(decrypted);
}

export function isAesGcmFormat(encrypted: string): boolean {
  if (!encrypted || encrypted.length < 40) return false;
  try {
    const decoded = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
    return decoded.length >= IV_LENGTH + 1 + 16;
  } catch {
    return false;
  }
}

export function getEncryptionKey(env: { JWT_SECRET: string }): string {
  if (!env.JWT_SECRET) {
    throw new Error('JWT_SECRET 环境变量未配置，无法加密存储凭证');
  }
  return env.JWT_SECRET;
}

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
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function signJWT(
  payload: Omit<JWTPayload, 'iat' | 'exp'>,
  secret: string,
  expiresInSeconds = 7 * 24 * 3600
): Promise<string> {
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
    256
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
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, baseKey, 256);

  const actualHashBytes = new Uint8Array(bits);

  // 将 expectedHash (hex string) 还原为 Uint8Array，再用 timingSafeEqual 进行常量时间比较
  // 避免字符串 === 比较的时序攻击漏洞
  const expectedHashBytes = new Uint8Array(expectedHash.match(/.{2}/g)!.map((b) => parseInt(b, 16)));

  if (actualHashBytes.length !== expectedHashBytes.length) return false;

  // 使用 crypto.subtle 的 HMAC verify 实现常量时间比较
  // （Workers 环境不提供 timingSafeEqual，此为等效替代）
  const hmacKey = await crypto.subtle.importKey('raw', actualHashBytes, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
  const sentinel = new Uint8Array(1);
  const sig1 = await crypto.subtle.sign('HMAC', hmacKey, sentinel);
  const hmacKey2 = await crypto.subtle.importKey('raw', expectedHashBytes, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
  const sig2 = await crypto.subtle.sign('HMAC', hmacKey2, sentinel);
  return (
    (await crypto.subtle.verify('HMAC', hmacKey, sig2, sentinel)) &&
    (await crypto.subtle.verify('HMAC', hmacKey2, sig1, sentinel))
  );
}
