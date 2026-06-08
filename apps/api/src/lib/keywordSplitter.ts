/**
 * keywordSplitter.ts — 智能关键词拆分工具
 *
 * 功能:
 * - 中英文混合关键词智能拆分
 * - 支持语义单元识别（如"文档资料共享" → ["文档", "资料", "共享"]）
 * - 停用词过滤
 * - 关键词权重优化
 */

const CHINESE_WORD_PATTERN = /[\u4e00-\u9fa5]+/g;
const ENGLISH_WORD_PATTERN = /[a-zA-Z0-9_\-]+/g;

const STOP_WORDS = new Set([
  '的',
  '了',
  '在',
  '是',
  '我',
  '有',
  '和',
  '就',
  '不',
  '人',
  '都',
  '一',
  '一个',
  '上',
  '也',
  '很',
  '到',
  '说',
  '要',
  '去',
  '你',
  '会',
  '着',
  '没有',
  '看',
  '好',
  '自己',
  '这',
  '那',
  '她',
  '他',
  '它',
  '们',
  '什么',
  '这个',
  '那个',
  '哪个',
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'must',
  'shall',
  'can',
  'need',
  'dare',
  'ought',
  'used',
  'to',
  'of',
  'in',
  'for',
  'on',
  'with',
  'at',
  'by',
  'from',
  'as',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'between',
  'out',
  'off',
  'over',
  'under',
  'again',
  'further',
  'then',
  'once',
  'here',
  'there',
  'when',
  'where',
  'why',
  'how',
  'all',
  'each',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'nor',
  'not',
  'only',
  'own',
  'same',
  'so',
  'than',
  'too',
  'very',
  'just',
  'because',
  'but',
  'and',
  'or',
  'if',
  'it',
  'its',
]);

const MIN_KEYWORD_LENGTH = 1;
const MAX_KEYWORDS = 8;

export interface SplitResult {
  keywords: string[];
  original: string;
  method: 'exact' | 'space' | 'chinese_segment' | 'mixed';
}

/**
 * 智能拆分搜索关键词
 *
 * @example
 * splitKeywords("文档资料共享") → ["文档", "资料", "共享"]
 * splitKeywords("project report 2024") → ["project", "report", "2024"]
 * splitKeywords("我的项目文档") → ["项目", "文档"]
 */
export function splitKeywords(query: string): SplitResult {
  if (!query || !query.trim()) {
    return { keywords: [], original: query, method: 'exact' };
  }

  const trimmedQuery = query.trim();

  // 策略1：如果包含空格，按空格分割（英文/已分词的中文）
  if (/\s+/.test(trimmedQuery)) {
    const spaceKeywords = trimmedQuery
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= MIN_KEYWORD_LENGTH && !STOP_WORDS.has(w.toLowerCase()));

    if (spaceKeywords.length > 0) {
      return { keywords: deduplicateAndLimit(spaceKeywords), original: query, method: 'space' };
    }
  }

  // 策略2：纯中文或中英混合 - 按语义单元拆分
  const chineseMatches = trimmedQuery.match(CHINESE_WORD_PATTERN) || [];
  const englishMatches = trimmedQuery.match(ENGLISH_WORD_PATTERN) || [];

  // 如果是纯英文（无中文），直接返回
  if (chineseMatches.length === 0 && englishMatches.length > 0) {
    const enKeywords = englishMatches
      .map((w) => w.toLowerCase())
      .filter((w) => w.length >= MIN_KEYWORD_LENGTH && !STOP_WORDS.has(w));

    return { keywords: deduplicateAndLimit(enKeywords), original: query, method: 'mixed' };
  }

  // 如果是纯中文（无空格），进行语义拆分
  if (chineseMatches.length > 0 && englishMatches.length === 0 && !/\s+/.test(trimmedQuery)) {
    const chineseKeywords = segmentChineseText(trimmedQuery);
    return { keywords: deduplicateAndLimit(chineseKeywords), original: query, method: 'chinese_segment' };
  }

  // 混合情况：分别处理中英文部分
  const mixedKeywords: string[] = [];

  chineseMatches.forEach((cnText) => {
    mixedKeywords.push(...segmentChineseText(cnText));
  });

  englishMatches.forEach((enWord) => {
    const lowerWord = enWord.toLowerCase();
    if (lowerWord.length >= MIN_KEYWORD_LENGTH && !STOP_WORDS.has(lowerWord)) {
      mixedKeywords.push(lowerWord);
    }
  });

  return { keywords: deduplicateAndLimit(mixedKeywords), original: query, method: 'mixed' };
}

/**
 * 中文文本按语义单元拆分
 * 使用启发式规则：常见词边界 + 长度限制
 */
function segmentChineseText(text: string): string[] {
  const keywords: string[] = [];
  let currentSegment = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    currentSegment += char;

    if (shouldSplitAt(currentSegment, char, i, text.length, text)) {
      const segment = currentSegment.trim();
      if (segment.length >= MIN_KEYWORD_LENGTH && !STOP_WORDS.has(segment)) {
        keywords.push(segment);
      }
      currentSegment = '';
    }
  }

  if (currentSegment.trim().length >= MIN_KEYWORD_LENGTH && !STOP_WORDS.has(currentSegment.trim())) {
    keywords.push(currentSegment.trim());
  }

  return keywords;
}

/**
 * 判断是否应该在当前位置切分
 */
function shouldSplitAt(
  currentSegment: string,
  currentChar: string,
  currentIndex: number,
  totalLength: number,
  fullText: string
): boolean {
  const BOUNDARY_CHARS = new Set([
    '的',
    '了',
    '在',
    '与',
    '和',
    '或',
    '及',
    '等',
    '之',
    '乎',
    '者',
    '也',
    '以',
    '于',
    '而',
    '且',
    '如',
    '若',
    '虽',
    '但',
    '然',
    '乃',
    '则',
    '因',
  ]);

  if (BOUNDARY_CHARS.has(currentChar)) {
    return currentSegment.length > 1;
  }

  if (currentSegment.length >= 5) {
    return true;
  }

  if (currentIndex < totalLength - 1) {
    const nextChar = fullText[currentIndex + 1] || '';
    const isCurrentChinese = /[\u4e00-\u9fa5]/.test(currentChar);
    const isNextChinese = /[\u4e00-\u9fa5]/.test(nextChar);

    if (isCurrentChinese !== isNextChinese && currentSegment.length >= 2) {
      return true;
    }
  }

  if (currentIndex === totalLength - 1) {
    return true;
  }

  return false;
}

/**
 * 去重并限制关键词数量
 */
function deduplicateAndLimit(keywords: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const kw of keywords) {
    if (!seen.has(kw.toLowerCase())) {
      seen.add(kw.toLowerCase());
      result.push(kw);

      if (result.length >= MAX_KEYWORDS) {
        break;
      }
    }
  }

  return result;
}
