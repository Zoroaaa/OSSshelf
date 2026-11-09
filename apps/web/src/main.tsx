import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';
// 代码高亮主题：rehype-highlight 输出 hljs class，需配套样式才会生效
import 'highlight.js/styles/github-dark.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
});

const savedTheme = localStorage.getItem('ossshelf-theme');
if (savedTheme) {
  try {
    const parsed = JSON.parse(savedTheme);
    const theme = parsed?.state?.theme || 'system';
    const root = document.documentElement;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const effectiveTheme = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;

    if (effectiveTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  } catch {
    // ignore
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    // 首次安装时 controller 为空，不需要提示更新
    const hadController = Boolean(navigator.serviceWorker.controller);
    const notifyUpdate = () => window.dispatchEvent(new Event('ossshelf:sw-update'));

    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
      });
      console.log('Service Worker registered:', registration.scope);

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && hadController) {
            notifyUpdate();
          }
        });
      });

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController) notifyUpdate();
      });

      // 应用回到前台时检查一次更新，避免长期停留在旧 SW 上
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          registration.update().catch(() => {});
        }
      });
    } catch (error) {
      console.error('Service Worker registration failed:', error);
    }
  });
}
