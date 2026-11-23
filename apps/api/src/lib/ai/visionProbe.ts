/**
 * visionProbe.ts
 * 视觉模型可用性探测
 *
 * 用内置纯色 PNG 发起一次真实图片调用，验证模型确实"看得见"图片。
 * 纯文本模型或输入格式不匹配时会忽略图片（返回空或"看不到图片"），可据此在配置阶段拦截，
 * 避免批量图片处理时静默失败。
 */

import type { Env } from '../../types/env';
import type { ModelConfig, TokenUsage } from './types';
import { completeText, completeTextWithConfig, type CompleteRequest } from './modelRuntime';
import { buildVisionMessageContent } from './utils';

/**
 * 64x64 纯红 PNG（仅 IHDR/IDAT/IEND，标准 RGB 编码）。
 * 不要换成带 sRGB/gAMA/pHYs 等附加块的图片：moondream 的解码器会拒绝并返回空。
 */
export const VISION_PROBE_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAS0lEQVR42u3PQQkAAAgAsetfWiP4FgYrsKZeS0BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEDgsqnc8OJg6Ln3AAAAAElFTkSuQmCC';

export const VISION_PROBE_PROMPT = '这张图片整体是什么颜色？只回答颜色名称。';

export interface VisionProbeResult {
  ok: boolean;
  answer: string;
  modelId: string;
  usage?: TokenUsage;
}

/** 纯红图片的答案应包含红/red；答非所问即视为没看到图片 */
export function isVisionProbeAnswer(answer: string): boolean {
  return /红|red/i.test(answer);
}

/**
 * 探测指定模型能否正确接收图片。
 * 传入 config 时按该配置直调（模型测试用，不记账）；否则按 modelId 解析用户配置（记账）。
 */
export async function probeVisionModel(
  env: Env,
  userId: string,
  options: { modelId?: string; config?: ModelConfig }
): Promise<VisionProbeResult> {
  const request: CompleteRequest = {
    messages: [
      {
        role: 'user',
        content: buildVisionMessageContent(VISION_PROBE_IMAGE_BASE64, 'image/png', VISION_PROBE_PROMPT),
      },
    ],
    featureType: 'image_analysis',
  };

  const result = options.config
    ? await completeTextWithConfig(env, options.config, request)
    : await completeText(env, userId, request, { modelId: options.modelId });

  const answer = result.content.trim();
  return { ok: isVisionProbeAnswer(answer), answer, modelId: result.modelId, usage: result.usage };
}
