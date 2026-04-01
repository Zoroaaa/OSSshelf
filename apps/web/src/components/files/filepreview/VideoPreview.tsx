/**
 * VideoPreview.tsx
 * 视频预览组件
 */

interface VideoPreviewProps {
  resolvedUrl: string;
  onLoadError: () => void;
}

export function VideoPreview({ resolvedUrl, onLoadError }: VideoPreviewProps) {
  return (
    <div className="flex items-center justify-center h-full">
      <video src={resolvedUrl} controls className="max-w-full max-h-full" onError={onLoadError} />
    </div>
  );
}
