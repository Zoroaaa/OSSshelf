/**
 * lazyPreviews.tsx
 * 预览器懒加载封装：重依赖（pdfjs / epubjs / jszip / papaparse / markdown 链 / office）
 * 只在真正打开对应类型文件时才下载，不再进入 /files 相关首屏 chunk。
 * 用法与原组件完全一致（同名、同 props），内部自带 Suspense。
 */
import { lazy, Suspense, type ComponentProps, type ComponentType } from 'react';

function PreviewFallback() {
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-muted-foreground">
      加载预览组件…
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyPreview<C extends ComponentType<any>>(loader: () => Promise<{ default: C }>) {
  const Inner = lazy(loader) as unknown as ComponentType<ComponentProps<C>>;
  function LazyPreview(props: ComponentProps<C>) {
    return (
      <Suspense fallback={<PreviewFallback />}>
        <Inner {...props} />
      </Suspense>
    );
  }
  // 对外保持与原组件完全相同的类型（props 接口无需导出即可通过 declaration 检查）
  return LazyPreview as unknown as C;
}

export const PdfPreview = lazyPreview(() => import('./PdfPreview').then((m) => ({ default: m.PdfPreview })));
export const MarkdownPreview = lazyPreview(() =>
  import('./MarkdownPreview').then((m) => ({ default: m.MarkdownPreview }))
);
export const CodePreview = lazyPreview(() => import('./CodePreview').then((m) => ({ default: m.CodePreview })));
export const OfficePreview = lazyPreview(() => import('./OfficePreview').then((m) => ({ default: m.OfficePreview })));
export const CsvPreview = lazyPreview(() => import('./CsvPreview').then((m) => ({ default: m.CsvPreview })));
export const ZipPreview = lazyPreview(() => import('./ZipPreview').then((m) => ({ default: m.ZipPreview })));
export const FontPreview = lazyPreview(() => import('./FontPreview').then((m) => ({ default: m.FontPreview })));
export const EpubPreview = lazyPreview(() => import('./EpubPreview').then((m) => ({ default: m.EpubPreview })));
