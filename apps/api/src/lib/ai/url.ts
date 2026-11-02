/**
 * url.ts
 * 统一的 URL 拼接，避免 baseUrl 末尾斜杠导致双斜杠。
 */

export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  const suffix = path.trim().replace(/^\/+/, '');
  return `${base}/${suffix}`;
}
