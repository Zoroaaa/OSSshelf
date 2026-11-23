/**
 * vitest.config.ts — web 测试配置
 * 用 mergeConfig 复用 vite.config.ts 的 react 插件与 @ alias，
 * 避免测试/构建两份 alias 漂移；测试环境必须是 jsdom（dialogStack 等依赖 document）。
 */
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
    },
  })
);
