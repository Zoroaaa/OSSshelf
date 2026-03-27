/**
 * PWAInstallPrompt.tsx
 * PWA 安装提示组件
 *
 * 功能:
 * - 检测可安装状态
 * - 显示安装提示
 * - 支持延迟显示
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Download, X, Smartphone } from 'lucide-react';
import { cn } from '@/utils';

interface PWAInstallPromptProps {
  className?: string;
}

export function PWAInstallPrompt({ className }: PWAInstallPromptProps) {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    const checkInstalled = () => {
      const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
      setIsInstalled(isStandalone);
    };

    checkInstalled();

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);

      const dismissedTime = localStorage.getItem('pwa-install-dismissed');
      if (dismissedTime) {
        const hoursSinceDismissed = (Date.now() - parseInt(dismissedTime)) / (1000 * 60 * 60);
        if (hoursSinceDismissed < 24) {
          return;
        }
      }

      setTimeout(() => setShowPrompt(true), 3000);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setShowPrompt(false);
      setIsInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;

      if (outcome === 'accepted') {
        setDeferredPrompt(null);
        setShowPrompt(false);
      }
    } catch (error) {
      console.error('Install failed:', error);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem('pwa-install-dismissed', Date.now().toString());
  };

  if (isInstalled || !showPrompt) return null;

  return (
    <div
      className={cn(
        'fixed bottom-20 lg:bottom-4 left-4 right-4 lg:left-auto lg:right-4 lg:w-80 z-40',
        'bg-card border rounded-xl shadow-lg p-4 animate-slide-up',
        className
      )}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Smartphone className="h-5 w-5 text-primary" />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm">安装应用</h3>
          <p className="text-xs text-muted-foreground mt-0.5">将 OSSshelf 添加到主屏幕，获得更好的使用体验</p>
        </div>

        <button onClick={handleDismiss} className="p-1 rounded-full hover:bg-accent flex-shrink-0">
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      <div className="flex gap-2 mt-3">
        <Button variant="outline" size="sm" className="flex-1" onClick={handleDismiss}>
          暂不
        </Button>
        <Button size="sm" className="flex-1" onClick={handleInstall}>
          <Download className="h-3.5 w-3.5 mr-1.5" />
          安装
        </Button>
      </div>
    </div>
  );
}

export function PWAPrompt() {
  const [showOfflineBanner, setShowOfflineBanner] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      if (showOfflineBanner) {
        setTimeout(() => setShowOfflineBanner(false), 2000);
      }
    };

    const handleOffline = () => {
      setIsOffline(true);
      setShowOfflineBanner(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [showOfflineBanner]);

  return (
    <>
      <PWAInstallPrompt />

      {showOfflineBanner && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-amber-950 px-4 py-2 text-center text-sm font-medium safe-top">
          {isOffline ? '网络已断开，部分功能可能不可用' : '网络已恢复'}
        </div>
      )}
    </>
  );
}
