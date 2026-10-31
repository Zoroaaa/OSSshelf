/**
 * Cloudflare 模型 ID 校验
 *
 * 支持的格式（与 agents/models/ai-sdk 的 createAI 一致）：
 * - Workers AI：@cf/<author>/<model>
 * - AI Gateway 目录：<author>/<model>
 * - 动态路由：dynamic/<route>
 *
 * UUID、空串、带空格的名称都不是可调用模型 ID。
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORKERS_AI_ID_PATTERN = /^@cf\/[a-z0-9][a-z0-9._/-]*$/i;
const GATEWAY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._/-]*$/i;
const DYNAMIC_ROUTE_PATTERN = /^dynamic\/[a-z0-9][a-z0-9._/-]*$/i;

export function isSupportedModelId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const id = value.trim();
  if (!id || UUID_PATTERN.test(id)) return false;
  return WORKERS_AI_ID_PATTERN.test(id) || GATEWAY_ID_PATTERN.test(id) || DYNAMIC_ROUTE_PATTERN.test(id);
}

/** 依次尝试候选值，返回第一个合法的模型 ID */
export function pickSupportedModelId(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && isSupportedModelId(candidate)) {
      return candidate.trim();
    }
  }
  return null;
}

export const MODEL_ID_FORMAT_HINT = '@cf/<author>/<model>、<author>/<model> 或 dynamic/<route>';
