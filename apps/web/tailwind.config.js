/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      /**
       * 语义化层级 token（审查报告 A-02）
       * 规则：业务弹窗统一 z-overlay；嵌套/右键菜单 z-popover；
       * Toast z-toast；AI 悬浮按钮 z-assistant 必须低于 overlay；系统提示 z-system。
       * 禁止再使用 z-[9999]/z-[10000]/裸 z-[100] 等魔数。
       */
      zIndex: {
        base: '0',
        raised: '10',
        dropdown: '25',
        assistant: '30',
        sticky: '40',
        overlay: '50',
        popover: '60',
        toast: '70',
        system: '80',
      },
      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
        popover: '0 10px 30px -10px rgb(0 0 0 / 0.25)',
        overlay: '0 25px 50px -12px rgb(0 0 0 / 0.4)',
      },
      spacing: {
        4.5: '1.125rem',
        5.5: '1.375rem',
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'spin-slow': {
          from: { transform: 'rotate(0deg)' },
          to: { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'spin-slow': 'spin-slow 3s linear infinite',
      },
      typography: {
        DEFAULT: {
          css: {
            maxWidth: 'none',
            pre: {
              'background-color': 'hsl(var(--muted))',
              'border-radius': 'var(--radius)',
              padding: '1rem',
              overflow: 'auto',
            },
            code: {
              'background-color': 'hsl(var(--muted))',
              'border-radius': 'calc(var(--radius) - 4px)',
              padding: '0.25rem 0.5rem',
              'font-weight': '400',
            },
            'code::before': {
              content: '""',
            },
            'code::after': {
              content: '""',
            },
            table: {
              'border-collapse': 'collapse',
              width: '100%',
            },
            th: {
              'background-color': 'hsl(var(--muted))',
              'font-weight': '600',
              padding: '0.75rem 1rem',
              'text-align': 'left',
              border: '1px solid hsl(var(--border))',
            },
            td: {
              padding: '0.75rem 1rem',
              border: '1px solid hsl(var(--border))',
            },
            'tr:nth-child(even)': {
              'background-color': 'hsl(var(--muted) / 0.3)',
            },
          },
        },
      },
    },
  },
  plugins: [require('@tailwindcss/typography'), require('tailwindcss-animate')],
};
