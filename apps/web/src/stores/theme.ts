import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark' | 'system';
export type EffectiveTheme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

/** 移动端浏览器地址栏/状态栏配色，随实际生效主题切换 */
const THEME_COLOR: Record<EffectiveTheme, string> = {
  light: '#3b82f6',
  dark: '#1e40af',
};

export const getSystemTheme = (): EffectiveTheme => {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

/** 把 light/dark/system 归一为实际生效的 light/dark */
export const resolveTheme = (theme: Theme): EffectiveTheme => (theme === 'system' ? getSystemTheme() : theme);

const applyTheme = (theme: Theme) => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const effectiveTheme = resolveTheme(theme);

  root.classList.toggle('dark', effectiveTheme === 'dark');
  // 让原生控件（select 下拉、日期选择器、滚动条、自动填充）跟随主题
  root.style.colorScheme = effectiveTheme;
  root.dataset.theme = effectiveTheme;

  // PWA / 移动端浏览器顶栏配色同步（index.html 只保留一个 theme-color meta）
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[effectiveTheme]);
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },
    }),
    {
      name: 'ossshelf-theme',
      onRehydrateStorage: () => (state) => {
        // 无论有无持久化数据都应用一次，保证首屏脚本与 store 状态一致
        applyTheme(state?.theme ?? 'system');
      },
      // 持久化只存 theme，避免把函数写进 localStorage
      partialize: (state) => ({ theme: state.theme }),
    }
  )
);

if (typeof window !== 'undefined') {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const handleSystemThemeChange = () => {
    const { theme } = useThemeStore.getState();
    if (theme === 'system') applyTheme('system');
  };

  // Safari 13 及更早版本只有 addListener，没有 addEventListener；缺失时降级，避免模块加载直接抛错
  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', handleSystemThemeChange);
  } else if (typeof mediaQuery.addListener === 'function') {
    mediaQuery.addListener(handleSystemThemeChange);
  }
}
