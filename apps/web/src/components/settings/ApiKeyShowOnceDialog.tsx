/**
 * ApiKeyShowOnceDialog.tsx
 * API Key 创建成功后显示（仅一次）
 */

import React, { useState, useRef } from 'react';
import { Button } from '../ui/Button';
import { useToast } from '../ui/useToast';

interface ApiKeyShowOnceDialogProps {
  apiKey: string;
  onClose: () => void;
}

const ApiKeyShowOnceDialog: React.FC<ApiKeyShowOnceDialogProps> = ({ apiKey, onClose }) => {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      toast({ title: '已复制到剪贴板' });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      if (inputRef.current) {
        inputRef.current.select();
        document.execCommand('copy');
        setCopied(true);
        toast({ title: '已复制到剪贴板' });
        setTimeout(() => setCopied(false), 2000);
      }
    }
  };

  const handleClose = () => {
    if (confirm('确定要关闭吗？关闭后将无法再次查看完整的 API Key。')) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-lg">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-green-600">API Key 创建成功</h3>
        </div>

        <div className="p-4 space-y-4">
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <svg
                className="w-6 h-6 text-yellow-500 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <div>
                <p className="font-medium text-yellow-800 dark:text-yellow-200">重要提示</p>
                <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                  请立即保存此 API Key。关闭此窗口后将无法再次查看完整的密钥。
                </p>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">API Key</label>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={apiKey}
                readOnly
                className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 font-mono text-sm"
              />
              <Button onClick={handleCopy} variant={copied ? 'default' : 'outline'}>
                {copied ? '已复制' : '复制'}
              </Button>
            </div>
          </div>

          <div className="text-sm text-gray-500">
            <p className="font-medium mb-1">使用方式：</p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                在请求头中添加{' '}
                <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">X-API-Key: {apiKey.slice(0, 15)}...</code>
              </li>
              <li>
                或使用{' '}
                <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">
                  Authorization: ApiKey {apiKey.slice(0, 15)}...
                </code>
              </li>
            </ul>
          </div>
        </div>

        <div className="flex items-center justify-end p-4 border-t border-gray-200 dark:border-gray-700">
          <Button onClick={handleClose}>我已保存，关闭</Button>
        </div>
      </div>
    </div>
  );
};

export default ApiKeyShowOnceDialog;
