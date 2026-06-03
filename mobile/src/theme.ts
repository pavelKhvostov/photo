// Тёмная «плёночная» тема приложения хоста

export const theme = {
  colors: {
    background: '#111010',
    surface: '#1c1b1b',
    surfaceElevated: '#252424',
    accent: '#d4a853',
    accentDim: '#a07c36',
    text: '#f0ede8',
    textSecondary: '#9e9a94',
    textMuted: '#5c5854',
    error: '#e05757',
    success: '#5aaa7a',
    border: '#2e2c2b',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  radius: {
    sm: 6,
    md: 12,
    lg: 20,
    full: 9999,
  },
  font: {
    sizes: {
      xs: 12,
      sm: 14,
      md: 16,
      lg: 20,
      xl: 26,
      xxl: 34,
    },
  },
} as const;
