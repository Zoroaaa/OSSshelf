/**
 * highlightCode.ts
 * highlight.js 封装。单独成文件，确保只有懒加载的 CodePreview 会引入 highlight.js，
 * 不再通过 previewUtils 进入 /files 首屏依赖。
 */
import hljs from 'highlight.js';

export function highlightCode(code: string, language: string): string {
  try {
    if (hljs.getLanguage(language)) {
      return hljs.highlight(code, { language }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch {
    return code;
  }
}
