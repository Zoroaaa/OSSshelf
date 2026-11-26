import { describe, expect, it } from 'vitest';
import { TOKEN_ESTIMATE_DEFAULTS, estimateTokens } from './utils';

describe('estimateTokens', () => {
  it('空文本返回 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('纯英文按每 token 4 字符估算', () => {
    expect(estimateTokens('abcdefgh')).toBe(2);
  });

  it('CJK 字符按每字 0.67 token 估算，不与英文系数混用', () => {
    expect(estimateTokens('你好世界')).toBe(Math.ceil(4 * TOKEN_ESTIMATE_DEFAULTS.cjkTokensPerChar));
  });

  it('中英混排分别计数', () => {
    // 8 个英文 = 2 tokens；2 个汉字 = ceil(1.34) = 2 → 合计 4
    expect(estimateTokens('abcdefgh你好')).toBe(4);
  });

  it('系数可覆盖，且越界值被 clamp', () => {
    expect(estimateTokens('abcdefgh', { charsPerToken: 2 })).toBe(4);
    expect(estimateTokens('abcdefgh', { charsPerToken: 0 })).toBe(8);
    expect(estimateTokens('你好', { cjkTokensPerChar: 0.5 })).toBe(1);
  });
});
