/**
 * FontPreview.tsx
 * 字体文件预览组件
 */

import { useEffect, useState, useCallback } from 'react';
import { Type } from 'lucide-react';

interface FontPreviewProps {
  resolvedUrl: string;
  fileName: string;
  zoomLevel: number;
  onLoadError: () => void;
}

export function FontPreview({ resolvedUrl, fileName, zoomLevel, onLoadError }: FontPreviewProps) {
  const [fontPreview, setFontPreview] = useState<{ name: string; preview: string } | null>(null);
  const [fontLoading, setFontLoading] = useState(false);

  const loadFontPreview = useCallback(async () => {
    setFontLoading(true);
    try {
      const response = await fetch(resolvedUrl);
      if (!response.ok) {
        throw new Error(`文件加载失败: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      const ext = fileName.split('.').pop()?.toLowerCase() || 'ttf';
      let format = 'truetype';
      if (ext === 'woff') format = 'woff';
      else if (ext === 'woff2') format = 'woff2';
      else if (ext === 'otf') format = 'opentype';
      const fontFace = new FontFace('PreviewFont', `url(data:font/${format};base64,${base64})`);
      await fontFace.load();
      document.fonts.add(fontFace);
      setFontPreview({
        name: fileName,
        preview: 'PreviewFont',
      });
    } catch (err) {
      console.error('Font preview error:', err);
      onLoadError();
    } finally {
      setFontLoading(false);
    }
  }, [resolvedUrl, fileName, onLoadError]);

  useEffect(() => {
    loadFontPreview();
  }, [loadFontPreview]);

  return (
    <div className="w-full h-full flex flex-col relative">
      {fontLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 z-10">
          <div className="text-muted-foreground text-sm">正在加载字体...</div>
        </div>
      )}
      {fontPreview ? (
        <div className="w-full h-full overflow-auto bg-white dark:bg-gray-900 p-6">
          <div className="text-center mb-8">
            <Type className="h-12 w-12 mx-auto mb-4 text-primary" />
            <h3 className="text-lg font-medium">{fontPreview.name}</h3>
          </div>
          <div className="space-y-6" style={{ fontFamily: fontPreview.preview, fontSize: `${zoomLevel}%` }}>
            <div className="text-center">
              <p className="text-4xl mb-2">AaBbCcDdEeFfGg</p>
              <p className="text-2xl mb-2">abcdefghijklmnopqrstuvwxyz</p>
              <p className="text-2xl mb-2">ABCDEFGHIJKLMNOPQRSTUVWXYZ</p>
              <p className="text-2xl mb-2">0123456789</p>
              <p className="text-xl mt-6">
                敏捷的棕色狐狸跳过懒狗。The quick brown fox jumps over the lazy dog.
              </p>
            </div>
            <div className="border-t pt-6">
              <p className="text-lg leading-relaxed">
                这是一段预览文本，用于展示字体的效果。字体预览可以帮助您了解字体在不同大小和样式下的表现。 This
                is a preview text to demonstrate the font effect. Font preview helps you understand how the font
                looks at different sizes and styles.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center h-full">
          <p className="text-center text-muted-foreground text-sm py-8">加载中...</p>
        </div>
      )}
    </div>
  );
}
