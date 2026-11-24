// ESLint 9 flat config（单一根配置，覆盖 apps/api、apps/web、packages/shared）
//
// 设计取舍（均为“为什么”）：
// - 不引入 eslint-plugin-prettier：它在每个文件里再跑一遍 prettier，是旧配置全量 lint >10 分钟的主因；
//   格式由 `pnpm format:check` 负责，eslint-config-prettier 只负责关掉与 prettier 冲突的规则。
// - 不开 type-aware（projectService）规则：当前规则集不需要类型信息，开了只会拖慢速度；
//   需要时再对特定目录单独开启。
// - 存量问题不靠放宽规则消化，而是由 scripts/lint-baseline.mjs 冻结：只拦“新增”问题。
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.wrangler/**',
      '**/*.tsbuildinfo',
      '**/*.config.js',
      '**/*.config.mjs',
      '**/*.config.ts',
      '**/*.d.ts',
      // 与旧配置（--ext .ts,.tsx）保持同一范围：不检查 js/mjs（含 vendored 的 pdf.worker.min.mjs、sw.js、脚本）
      '**/*.{js,mjs,cjs}',
      'apps/android/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, ...globals.es2022 },
    },
    linterOptions: { reportUnusedDisableDirectives: 'warn' },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error', 'log'] }],
      'prefer-const': 'error',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  prettier
);
