/**
 * s3client.ts
 * S3兼容存储客户端
 *
 * 功能:
 * - 支持多种S3兼容存储（R2、S3、OSS、COS、OBS、B2、MinIO等）
 * - AWS Signature V4签名实现
 * - 文件上传/下载/删除操作
 * - 分片上传支持
 * - 存储凭证AES-GCM加密
 * - 自动迁移旧版XOR混淆凭证
 *
 * 运行在Cloudflare Workers环境，无需Node.js SDK
 */

import { eq } from 'drizzle-orm';
import type { Env } from '../types/env';
import type { storageBuckets } from '../db/schema';
import { encryptCredential, decryptCredential, getEncryptionKey, isAesGcmFormat } from './crypto';
import { logger } from '@osshelf/shared';

export interface S3BucketConfig {
  id: string;
  provider: string;
  bucketName: string;
  endpoint: string | null;
  region: string | null;
  accessKeyId: string; // Already decrypted
  secretAccessKey: string; // Already decrypted
  pathStyle: boolean;
}

// ── Credential encryption/decryption (AES-GCM) ─────────────────────────────
export async function encryptSecret(value: string, secret: string): Promise<string> {
  return encryptCredential(value, secret);
}

export async function decryptSecret(encrypted: string, secret: string): Promise<string> {
  return decryptCredential(encrypted, secret);
}

// Legacy sync functions for backward compatibility (deprecated)
export function deobfuscate(value: string, key: string): string {
  try {
    const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
    const keyBytes = new TextEncoder().encode(key.repeat(Math.ceil(bytes.length / key.length)));
    const result = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      result[i] = bytes[i] ^ keyBytes[i];
    }
    return new TextDecoder().decode(result);
  } catch {
    return value;
  }
}

export function obfuscate(value: string, key: string): string {
  const keyBytes = new TextEncoder().encode(key.repeat(Math.ceil(value.length / key.length)));
  const valueBytes = new TextEncoder().encode(value);
  const result = new Uint8Array(valueBytes.length);
  for (let i = 0; i < valueBytes.length; i++) {
    result[i] = valueBytes[i] ^ keyBytes[i];
  }
  return btoa(String.fromCharCode(...result));
}

// ── Endpoint resolution ──────────────────────────────────────────────────
export function resolveEndpoint(provider: string, endpoint: string | null, region: string | null): string {
  if (endpoint) return endpoint.replace(/\/$/, '');
  const r = region || 'us-east-1';
  switch (provider) {
    case 's3':
      return `https://s3.${r}.amazonaws.com`;
    case 'oss':
      return `https://oss-${r}.aliyuncs.com`;
    case 'cos':
      return `https://cos.${r}.myqcloud.com`;
    case 'obs':
      return `https://obs.${r}.myhuaweicloud.com`;
    case 'b2':
      return 'https://s3.us-west-004.backblazeb2.com';
    case 'minio':
      return 'http://localhost:9000';
    default:
      return '';
  }
}

// ── Build object URL ─────────────────────────────────────────────────────
function buildObjectUrl(config: S3BucketConfig, key: string): { url: string; host: string; canonicalUri: string } {
  const endpoint = resolveEndpoint(config.provider, config.endpoint, config.region);
  if (!endpoint) throw new Error(`无法解析存储桶 Endpoint（provider: ${config.provider}）`);

  const encodedKey = key.split('/').map(encodeURIComponent).join('/');

  if (config.pathStyle) {
    const url = `${endpoint}/${config.bucketName}/${encodedKey}`;
    const host = new URL(endpoint).host;
    return { url, host, canonicalUri: `/${config.bucketName}/${encodedKey}` };
  } else {
    const proto = endpoint.match(/^https?:\/\//)?.[0] || 'https://';
    const rest = endpoint.replace(/^https?:\/\//, '');
    const url = `${proto}${config.bucketName}.${rest}/${encodedKey}`;
    const host = `${config.bucketName}.${new URL(endpoint).host}`;
    return { url, host, canonicalUri: `/${encodedKey}` };
  }
}

// ── AWS Signature V4 ─────────────────────────────────────────────────────
const enc = new TextEncoder();

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const buf = typeof data === 'string' ? enc.encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', buf as BufferSource);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSHA256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
}

async function deriveSigningKey(secretKey: string, dateStamp: string, region: string): Promise<ArrayBuffer> {
  const kDate = await hmacSHA256(enc.encode(`AWS4${secretKey}`), dateStamp);
  const kRegion = await hmacSHA256(kDate, region);
  const kService = await hmacSHA256(kRegion, 's3');
  return hmacSHA256(kService, 'aws4_request');
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

async function signRequest(opts: {
  method: string;
  url: string;
  host: string;
  canonicalUri: string;
  queryString: string;
  payloadHash: string;
  contentType?: string;
  extraHeaders?: Record<string, string>;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}): Promise<SignedRequest> {
  const now = new Date();
  const amzDate = now
    .toISOString()
    .replace(/[:-]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const dateStamp = amzDate.slice(0, 8);
  const region = opts.region || 'us-east-1';

  const headers: Record<string, string> = {
    host: opts.host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': opts.payloadHash,
    ...opts.extraHeaders,
  };
  if (opts.contentType) headers['content-type'] = opts.contentType;

  const sortedKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${headers[k]}\n`).join('');
  const signedHeadersStr = sortedKeys.join(';');

  const canonicalRequest = [
    opts.method,
    opts.canonicalUri,
    opts.queryString,
    canonicalHeaders,
    signedHeadersStr,
    opts.payloadHash,
  ].join('\n');

  const credScope = `${dateStamp}/${region}/s3/aws4_request`;
  const canonicalHash = await sha256Hex(canonicalRequest);
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credScope, canonicalHash].join('\n');

  const signingKey = await deriveSigningKey(opts.secretAccessKey, dateStamp, region);
  const sigBuf = await hmacSHA256(signingKey, stringToSign);
  const signature = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const authHeader = `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${credScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`;
  headers['Authorization'] = authHeader;

  return { url: opts.url, headers };
}

// ── Presigned URL (query-string auth) ────────────────────────────────────

/**
 * Generate a presigned URL for a PUT (upload) or GET (download/preview).
 *
 * The signature is embedded in query parameters — no Authorization header
 * needed. The browser / client uploads or downloads directly.
 *
 * @param method  'PUT' | 'GET'
 * @param config  Bucket config with decrypted credentials
 * @param key     S3 object key
 * @param expiresIn  Seconds until URL expires (default 3600 = 1h)
 * @param contentType  Required for PUT presigns — tells S3 what Content-Type to expect
 */
export async function s3PresignUrl(
  config: S3BucketConfig,
  method: 'PUT' | 'GET',
  key: string,
  expiresIn = 3600,
  contentType?: string
): Promise<string> {
  const { url, host, canonicalUri } = buildObjectUrl(config, key);
  const region = config.region || 'us-east-1';

  const now = new Date();
  const amzDate = now
    .toISOString()
    .replace(/[:-]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const dateStamp = amzDate.slice(0, 8);

  const credScope = `${dateStamp}/${region}/s3/aws4_request`;
  const credential = `${config.accessKeyId}/${credScope}`;

  // Build canonical query string — alphabetical order required
  const queryParams: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresIn),
    'X-Amz-SignedHeaders': 'host',
  };

  // For PUT presigns, include Content-Type in signed headers when provided.
  // However most S3 providers (and R2) do NOT enforce Content-Type in presign
  // query-auth — we pass it as metadata only and sign only 'host' to keep
  // client-side usage simple (no extra header on the actual PUT request).
  // Tencent COS requires x-cos-security-token but we don't use STS here.

  const sortedQuery = Object.keys(queryParams)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(queryParams[k])}`)
    .join('&');

  const canonicalHeaders = `host:${host}\n`;
  const signedHeadersStr = 'host';
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = [method, canonicalUri, sortedQuery, canonicalHeaders, signedHeadersStr, payloadHash].join(
    '\n'
  );

  const canonicalHash = await sha256Hex(canonicalRequest);
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credScope, canonicalHash].join('\n');

  const signingKey = await deriveSigningKey(config.secretAccessKey, dateStamp, region);
  const sigBuf = await hmacSHA256(signingKey, stringToSign);
  const signature = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Append signature to the URL
  const fullQuery = `${sortedQuery}&X-Amz-Signature=${signature}`;

  // Parse the base URL to properly append query
  const urlObj = new URL(url);
  return `${urlObj.origin}${urlObj.pathname}?${fullQuery}`;
}

// ── Multipart Upload ─────────────────────────────────────────────────────

export interface MultipartPart {
  partNumber: number;
  etag: string;
}

/**
 * Initiate a multipart upload. Returns the UploadId.
 */
export async function s3CreateMultipartUpload(
  config: S3BucketConfig,
  key: string,
  contentType: string
): Promise<string> {
  const { url, host, canonicalUri } = buildObjectUrl(config, key);
  const region = config.region || 'us-east-1';
  const queryString = 'uploads=';
  const uploadUrl = `${url}?uploads`;
  const payloadHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  const signed = await signRequest({
    method: 'POST',
    url: uploadUrl,
    host,
    canonicalUri,
    queryString,
    payloadHash,
    contentType,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region,
  });

  const res = await fetch(signed.url, {
    method: 'POST',
    headers: signed.headers,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Multipart initiate 失败 (${res.status}): ${text.slice(0, 300)}`);
  }

  const xml = await res.text();
  const match = xml.match(/<UploadId>([^<]+)<\/UploadId>/);
  if (!match) throw new Error('Multipart initiate: 无法解析 UploadId');
  return match[1];
}

/**
 * Generate a presigned URL for uploading a single part.
 */
export async function s3PresignUploadPart(
  config: S3BucketConfig,
  key: string,
  uploadId: string,
  partNumber: number,
  expiresIn = 3600
): Promise<string> {
  const { url: baseUrl, host, canonicalUri } = buildObjectUrl(config, key);
  const region = config.region || 'us-east-1';

  const now = new Date();
  const amzDate = now
    .toISOString()
    .replace(/[:-]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const dateStamp = amzDate.slice(0, 8);

  const credScope = `${dateStamp}/${region}/s3/aws4_request`;
  const credential = `${config.accessKeyId}/${credScope}`;

  const queryParams: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresIn),
    'X-Amz-SignedHeaders': 'host',
    partNumber: String(partNumber),
    uploadId: uploadId,
  };

  const sortedQuery = Object.keys(queryParams)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(queryParams[k])}`)
    .join('&');

  const canonicalRequest = ['PUT', canonicalUri, sortedQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');

  const canonicalHash = await sha256Hex(canonicalRequest);
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credScope, canonicalHash].join('\n');

  const signingKey = await deriveSigningKey(config.secretAccessKey, dateStamp, region);
  const sigBuf = await hmacSHA256(signingKey, stringToSign);
  const signature = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const urlObj = new URL(baseUrl);
  return `${urlObj.origin}${urlObj.pathname}?${sortedQuery}&X-Amz-Signature=${signature}`;
}

/**
 * Upload a single part directly from the server (proxy upload).
 * Returns the ETag from the response.
 */
export async function s3UploadPart(
  config: S3BucketConfig,
  key: string,
  uploadId: string,
  partNumber: number,
  body: ArrayBuffer | Uint8Array
): Promise<string> {
  const { url: baseUrl, host, canonicalUri } = buildObjectUrl(config, key);
  const region = config.region || 'us-east-1';

  const encodedUploadId = encodeURIComponent(uploadId);
  const queryString = `partNumber=${partNumber}&uploadId=${encodedUploadId}`;
  const partUrl = `${baseUrl}?partNumber=${partNumber}&uploadId=${encodedUploadId}`;

  const bodyUint8 = body instanceof ArrayBuffer ? new Uint8Array(body) : body;
  const payloadHash = await sha256Hex(bodyUint8);

  const signed = await signRequest({
    method: 'PUT',
    url: partUrl,
    host,
    canonicalUri,
    queryString,
    payloadHash,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region,
  });

  const res = await fetch(signed.url, {
    method: 'PUT',
    headers: signed.headers,
    body: bodyUint8 as BodyInit,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`分片上传失败 (${res.status}): ${text.slice(0, 300)}`);
  }

  const etag = res.headers.get('ETag') || res.headers.get('etag') || '';
  return etag.replace(/"/g, '');
}

/**
 * Complete a multipart upload by sending the parts manifest.
 */
export async function s3CompleteMultipartUpload(
  config: S3BucketConfig,
  key: string,
  uploadId: string,
  parts: MultipartPart[]
): Promise<void> {
  const { url: baseUrl, host, canonicalUri } = buildObjectUrl(config, key);
  const region = config.region || 'us-east-1';

  const partsXml = parts
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`)
    .join('');
  const body = `<CompleteMultipartUpload>${partsXml}</CompleteMultipartUpload>`;

  const encodedUploadId = encodeURIComponent(uploadId);
  const queryString = `uploadId=${encodedUploadId}`;
  const completeUrl = `${baseUrl}?${queryString}`;

  const payloadHash = await sha256Hex(body);
  const signed = await signRequest({
    method: 'POST',
    url: completeUrl,
    host,
    canonicalUri,
    queryString,
    payloadHash,
    contentType: 'application/xml',
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region,
  });

  const res = await fetch(signed.url, {
    method: 'POST',
    headers: signed.headers,
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Multipart complete 失败 (${res.status}): ${text.slice(0, 300)}`);
  }
}

/**
 * List parts that have been uploaded for a multipart upload.
 */
export async function s3ListParts(config: S3BucketConfig, key: string, uploadId: string): Promise<MultipartPart[]> {
  const { url: baseUrl, host, canonicalUri } = buildObjectUrl(config, key);
  const region = config.region || 'us-east-1';

  const encodedUploadId = encodeURIComponent(uploadId);
  const queryString = `uploadId=${encodedUploadId}`;
  const listUrl = `${baseUrl}?${queryString}`;

  const payloadHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const signed = await signRequest({
    method: 'GET',
    url: listUrl,
    host,
    canonicalUri,
    queryString,
    payloadHash,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region,
  });

  const res = await fetch(signed.url, { method: 'GET', headers: signed.headers });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`List parts 失败 (${res.status}): ${text.slice(0, 300)}`);
  }

  const xml = await res.text();
  const parts: MultipartPart[] = [];
  const partRegex = /<Part>\s*<PartNumber>(\d+)<\/PartNumber>\s*<ETag>"?([^"<]+)"?<\/ETag>\s*<\/Part>/g;
  let match;
  while ((match = partRegex.exec(xml)) !== null) {
    parts.push({
      partNumber: parseInt(match[1], 10),
      etag: match[2],
    });
  }
  return parts;
}

/**
 * Abort a multipart upload (cleanup on failure).
 */
export async function s3AbortMultipartUpload(config: S3BucketConfig, key: string, uploadId: string): Promise<void> {
  const { url: baseUrl, host, canonicalUri } = buildObjectUrl(config, key);
  const region = config.region || 'us-east-1';

  const encodedUploadId = encodeURIComponent(uploadId);
  const queryString = `uploadId=${encodedUploadId}`;
  const abortUrl = `${baseUrl}?${queryString}`;

  const payloadHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const signed = await signRequest({
    method: 'DELETE',
    url: abortUrl,
    host,
    canonicalUri,
    queryString,
    payloadHash,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region,
  });

  await fetch(signed.url, { method: 'DELETE', headers: signed.headers });
  // Ignore errors — abort is best-effort
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Upload an object to an S3-compatible bucket.
 * @param contentLength - Required for streaming bodies; many S3 providers require Content-Length header
 */
export async function s3Put(
  config: S3BucketConfig,
  key: string,
  body: ReadableStream | ArrayBuffer | Uint8Array,
  contentType: string,
  metadata?: Record<string, string>,
  contentLength?: number
): Promise<void> {
  const { url, host, canonicalUri } = buildObjectUrl(config, key);
  const region = config.region || 'us-east-1';

  // For streaming bodies we can't compute SHA256; use UNSIGNED-PAYLOAD for chunked uploads
  // Most S3-compatible providers accept this for PUT
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const extraHeaders: Record<string, string> = {};
  if (metadata) {
    for (const [k, v] of Object.entries(metadata)) {
      const encodedValue = /[^\x00-\x7F]/.test(v) ? `=?UTF-8?B?${btoa(unescape(encodeURIComponent(v)))}?=` : v;
      extraHeaders[`x-amz-meta-${k.toLowerCase()}`] = encodedValue;
    }
  }

  // 如果提供了 contentLength，必须在签名头和请求头中都包含
  // AWS Signature V4 要求签名头与实际请求头完全一致
  // 许多 S3 兼容存储要求必须有 Content-Length 头
  if (contentLength !== undefined) {
    extraHeaders['content-length'] = String(contentLength);
  }

  const signed = await signRequest({
    method: 'PUT',
    url,
    host,
    canonicalUri,
    queryString: '',
    payloadHash,
    contentType,
    extraHeaders,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region,
  });

  const res = await fetch(signed.url, {
    method: 'PUT',
    headers: signed.headers,
    body: body as BodyInit,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`S3 PUT 失败 (${res.status}): ${text.slice(0, 300)}`);
  }
}

/**
 * Get an object from an S3-compatible bucket.
 * Returns the Response so the caller can stream the body.
 */
export async function s3Get(config: S3BucketConfig, key: string): Promise<Response> {
  const { url, host, canonicalUri } = buildObjectUrl(config, key);
  const region = config.region || 'us-east-1';
  const payloadHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'; // empty

  const signed = await signRequest({
    method: 'GET',
    url,
    host,
    canonicalUri,
    queryString: '',
    payloadHash,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region,
  });

  const res = await fetch(signed.url, { method: 'GET', headers: signed.headers });

  if (!res.ok && res.status !== 206) {
    throw new Error(`S3 GET 失败 (${res.status})`);
  }
  return res;
}

/**
 * Delete an object from an S3-compatible bucket.
 */
export async function s3Delete(config: S3BucketConfig, key: string): Promise<void> {
  const { url, host, canonicalUri } = buildObjectUrl(config, key);
  const region = config.region || 'us-east-1';
  const payloadHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  const signed = await signRequest({
    method: 'DELETE',
    url,
    host,
    canonicalUri,
    queryString: '',
    payloadHash,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region,
  });

  const res = await fetch(signed.url, { method: 'DELETE', headers: signed.headers });
  // 204 No Content = success; 404 = already gone (treat as ok)
  if (!res.ok && res.status !== 204 && res.status !== 404) {
    const text = await res.text().catch(() => '');
    throw new Error(`S3 DELETE 失败 (${res.status}): ${text.slice(0, 200)}`);
  }
}

/**
 * Head an object (check existence, get metadata).
 */
export async function s3Head(config: S3BucketConfig, key: string): Promise<Response> {
  const { url, host, canonicalUri } = buildObjectUrl(config, key);
  const region = config.region || 'us-east-1';
  const payloadHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  const signed = await signRequest({
    method: 'HEAD',
    url,
    host,
    canonicalUri,
    queryString: '',
    payloadHash,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region,
  });

  return fetch(signed.url, { method: 'HEAD', headers: signed.headers });
}

// ── Bucket resolver helper ────────────────────────────────────────────────
/**
 * Given a DB row from storage_buckets, return a ready-to-use S3BucketConfig
 * with decrypted credentials using AES-GCM.
 *
 * This function uses isAesGcmFormat to quickly detect format, avoiding
 * unnecessary AES-GCM decryption attempts on legacy XOR data.
 *
 * Auto-migration: If legacy XOR format is detected and db is provided,
 * credentials will be upgraded to AES-GCM encryption.
 */
export async function makeBucketConfigAsync(
  row: typeof import('../db/schema').storageBuckets.$inferSelect,
  encKey: string,
  db?: ReturnType<typeof import('../db').getDb>
): Promise<S3BucketConfig> {
  const isAesGcm = isAesGcmFormat(row.accessKeyId) && isAesGcmFormat(row.secretAccessKey);

  let accessKeyId: string;
  let secretAccessKey: string;

  if (isAesGcm) {
    accessKeyId = await decryptCredential(row.accessKeyId, encKey);
    secretAccessKey = await decryptCredential(row.secretAccessKey, encKey);
  } else {
    accessKeyId = deobfuscate(row.accessKeyId, encKey);
    secretAccessKey = deobfuscate(row.secretAccessKey, encKey);

    if (db) {
      try {
        const encryptedAccessKeyId = await encryptCredential(accessKeyId, encKey);
        const encryptedSecretAccessKey = await encryptCredential(secretAccessKey, encKey);
        const { storageBuckets } = await import('../db');
        await db
          .update(storageBuckets)
          .set({
            accessKeyId: encryptedAccessKeyId,
            secretAccessKey: encryptedSecretAccessKey,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(storageBuckets.id, row.id));
        logger.info('S3_MIGRATION', '凭证升级为AES-GCM', { bucketId: row.id });
      } catch (migrationError) {
        logger.error('S3_MIGRATION', '凭证升级失败', { bucketId: row.id }, migrationError);
      }
    }
  }

  return {
    id: row.id,
    provider: row.provider,
    bucketName: row.bucketName,
    endpoint: row.endpoint,
    region: row.region,
    accessKeyId,
    secretAccessKey,
    pathStyle: row.pathStyle,
  };
}

/**
 * Legacy sync version for backward compatibility.
 * @deprecated Use makeBucketConfigAsync instead for proper AES-GCM decryption.
 */
export function makeBucketConfig(
  row: typeof import('../db/schema').storageBuckets.$inferSelect,
  encKey: string
): S3BucketConfig {
  return {
    id: row.id,
    provider: row.provider,
    bucketName: row.bucketName,
    endpoint: row.endpoint,
    region: row.region,
    accessKeyId: deobfuscate(row.accessKeyId, encKey),
    secretAccessKey: deobfuscate(row.secretAccessKey, encKey),
    pathStyle: row.pathStyle,
  };
}

/**
 * Test connectivity to a bucket using HeadBucket.
 */
export async function testS3Connection(config: S3BucketConfig): Promise<{
  connected: boolean;
  message: string;
  statusCode: number;
}> {
  const endpoint = resolveEndpoint(config.provider, config.endpoint, config.region);
  if (!endpoint) throw new Error('未配置 Endpoint，无法测试连接');

  const region = config.region || 'us-east-1';
  let bucketUrl: string;
  let host: string;
  let canonicalUri: string;

  if (config.pathStyle) {
    bucketUrl = `${endpoint}/${config.bucketName}/`;
    host = new URL(endpoint).host;
    canonicalUri = `/${config.bucketName}/`;
  } else {
    const proto = endpoint.match(/^https?:\/\//)?.[0] || 'https://';
    const rest = endpoint.replace(/^https?:\/\//, '');
    bucketUrl = `${proto}${config.bucketName}.${rest}/`;
    host = `${config.bucketName}.${new URL(endpoint).host}`;
    canonicalUri = '/';
  }

  const payloadHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'; // SHA256('')

  // 复用 signRequest 避免重复签名逻辑
  const signed = await signRequest({
    method: 'HEAD',
    url: bucketUrl,
    host,
    canonicalUri,
    queryString: '',
    payloadHash,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region,
  });

  const res = await fetch(signed.url, { method: 'HEAD', headers: signed.headers });

  if (res.status === 200 || res.status === 204) {
    return { connected: true, message: '连接成功', statusCode: res.status };
  } else if (res.status === 403) {
    return { connected: true, message: '凭证有效，但权限受限（存储桶存在）', statusCode: res.status };
  } else if (res.status === 301 || res.status === 307) {
    return { connected: true, message: '连接成功（请检查区域配置）', statusCode: res.status };
  } else {
    const errText = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200) || '连接失败'}`);
  }
}
