/**
 * AudioPreview.tsx
 * 音频预览组件
 */

import { Volume2 } from 'lucide-react';
import { decodeFileName } from '@/utils';

interface AudioPreviewProps {
  resolvedUrl: string;
  fileName: string;
  onLoadError: () => void;
}

export function AudioPreview({ resolvedUrl, fileName, onLoadError }: AudioPreviewProps) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="p-8 w-full max-w-md space-y-4">
        <div className="flex items-center justify-center">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
            <Volume2 className="h-10 w-10 text-primary" />
          </div>
        </div>
        <p className="text-center font-medium">{decodeFileName(fileName)}</p>
        <audio src={resolvedUrl} controls className="w-full" onError={onLoadError} />
      </div>
    </div>
  );
}
