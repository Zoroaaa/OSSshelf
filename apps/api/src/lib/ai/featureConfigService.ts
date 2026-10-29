/**
 * featureConfigService.ts
 * 功能级模型配置（D1 为准，兼容一次性从 KV 迁移）
 */

import { eq } from 'drizzle-orm';
import { getDb, aiFeatureConfig } from '../../db';
import type { Env } from '../../types/env';
import { logger } from '@osshelf/shared';

export interface FeatureModelConfig {
  summary?: string;
  imageCaption?: string;
  imageTag?: string;
  rename?: string;
}

const FEATURE_BY_CONFIG_KEY: Record<keyof FeatureModelConfig, string> = {
  summary: 'summary',
  imageCaption: 'image_caption',
  imageTag: 'image_tag',
  rename: 'rename',
};

const CONFIG_KEY_BY_FEATURE = Object.fromEntries(
  Object.entries(FEATURE_BY_CONFIG_KEY).map(([configKey, feature]) => [feature, configKey])
) as Record<string, keyof FeatureModelConfig>;

const LEGACY_KV_KEY = (userId: string) => `ai:feature-model-config:${userId}`;

function toConfig(rows: Array<typeof aiFeatureConfig.$inferSelect>): FeatureModelConfig {
  const config: FeatureModelConfig = {};
  for (const row of rows) {
    const configKey = CONFIG_KEY_BY_FEATURE[row.feature];
    if (configKey && row.modelId) config[configKey] = row.modelId;
  }
  return config;
}

export async function getFeatureModelConfig(env: Env, userId: string): Promise<FeatureModelConfig> {
  try {
    const db = getDb(env.DB);
    const rows = await db.select().from(aiFeatureConfig).where(eq(aiFeatureConfig.userId, userId)).all();

    if (rows.length > 0) return toConfig(rows);

    // 一次性从 KV 迁移
    const legacy = await env.KV.get<FeatureModelConfig>(LEGACY_KV_KEY(userId), 'json');
    if (legacy) {
      await saveFeatureModelConfig(env, userId, legacy);
      return legacy;
    }

    return {};
  } catch (error) {
    logger.error('AI', 'Failed to get feature model config', { userId }, error);
    return {};
  }
}

export async function saveFeatureModelConfig(env: Env, userId: string, config: FeatureModelConfig): Promise<void> {
  const db = getDb(env.DB);
  const now = new Date().toISOString();

  for (const [configKey, feature] of Object.entries(FEATURE_BY_CONFIG_KEY)) {
    const modelId = config[configKey as keyof FeatureModelConfig] ?? null;

    await db
      .insert(aiFeatureConfig)
      .values({
        id: crypto.randomUUID(),
        userId,
        feature,
        modelId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [aiFeatureConfig.userId, aiFeatureConfig.feature],
        set: { modelId, updatedAt: now },
      });
  }
}
