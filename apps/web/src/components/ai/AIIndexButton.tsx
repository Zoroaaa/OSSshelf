/**
 * AIIndexButton.tsx
 * AI 索引入口按钮组件
 */

import { useState } from 'react';
import { Database, Loader2 } from 'lucide-react';
import { aiApi } from '@/services/api';
import { Button } from '@/components/ui/Button';

interface AIIndexButtonProps {
  fileId: string;
  isIndexed?: boolean;
  onIndexed?: () => void;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export function AIIndexButton({
  fileId,
  isIndexed = false,
  onIndexed,
  variant = 'outline',
  size = 'sm',
}: AIIndexButtonProps) {
  const [isIndexing, setIsIndexing] = useState(false);

  const handleIndex = async () => {
    setIsIndexing(true);
    try {
      const response = await aiApi.indexFile(fileId);
      if (response.data.success) {
        onIndexed?.();
      }
    } catch (error) {
      console.error('Failed to index file:', error);
    } finally {
      setIsIndexing(false);
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleIndex}
      disabled={isIndexing}
      title={isIndexed ? '重新索引' : '建立索引'}
    >
      {isIndexing ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Database className="h-4 w-4" />
      )}
    </Button>
  );
}
