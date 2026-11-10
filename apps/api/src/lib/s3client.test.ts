import { describe, it, expect } from 'vitest';
import { s3PresignUrl, type S3BucketConfig } from './s3client';

const config: S3BucketConfig = {
  id: 'bucket-1',
  provider: 'b2',
  bucketName: 'demo-bucket',
  endpoint: 'https://s3.us-west-004.backblazeb2.com',
  region: 'us-east-1',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secretEXAMPLEKEY',
  pathStyle: true,
};

/** SigV4 规范的 UriEncode：只有 A-Za-z0-9-._~ 不编码 */
function awsUriEncode(value: string): string {
  return Array.from(new TextEncoder().encode(value))
    .map((byte) => {
      const ch = String.fromCharCode(byte);
      if (/[A-Za-z0-9\-._~]/.test(ch)) return ch;
      return `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');
}

async function sha256Hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data)));
}

/**
 * 用「对象存储服务端」的视角校验预签名 URL：
 * 解析收到的 URL，解码 query，按 SigV4 规则重新编码并重算签名。
 * 与签名端编码口径不一致时（如 ! ' ( ) * 未编码），这里会算不出同一个签名。
 */
async function verifyPresignedUrl(
  url: string,
  secretAccessKey: string,
  region: string,
  method = 'GET'
): Promise<boolean> {
  const u = new URL(url);
  const amzDate = u.searchParams.get('X-Amz-Date')!;
  const dateStamp = amzDate.slice(0, 8);
  const credScope = u.searchParams.get('X-Amz-Credential')!.split('/').slice(1).join('/');

  const canonicalQuery = [...u.searchParams.entries()]
    .filter(([k]) => k !== 'X-Amz-Signature')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${awsUriEncode(k)}=${awsUriEncode(v)}`)
    .join('&');

  const canonicalRequest = [method, u.pathname, canonicalQuery, `host:${u.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join(
    '\n'
  );
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credScope, await sha256Hex(canonicalRequest)].join('\n');

  const kDate = await hmac(new TextEncoder().encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, 's3');
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = Array.from(await hmac(kSigning, stringToSign))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return signature === u.searchParams.get('X-Amz-Signature');
}

describe('s3client 预签名', () => {
  it('带 content-disposition 的下载 URL 能被服务端校验通过', async () => {
    const disposition = `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`;
    const url = await s3PresignUrl(config, 'GET', 'files/u1/f1/report.pdf', 3600, undefined, disposition);
    expect(await verifyPresignedUrl(url, config.secretAccessKey, config.region!)).toBe(true);
  });

  it('含空格/括号/单引号/中文的 key 下载签名一致', async () => {
    const url = await s3PresignUrl(config, 'GET', `files/u1/f1/报告 (1) 'x'.pdf`, 3600);
    expect(await verifyPresignedUrl(url, config.secretAccessKey, config.region!)).toBe(true);
  });

  it('上传用预签名同样通过校验', async () => {
    const url = await s3PresignUrl(config, 'PUT', 'files/u1/f1/a b.txt', 3600, 'text/plain');
    expect(await verifyPresignedUrl(url, config.secretAccessKey, config.region!, 'PUT')).toBe(true);
  });
});
