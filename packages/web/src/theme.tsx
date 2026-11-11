import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

// ─── Theme definitions ──────────────────────────────────────────────────────

export type ThemeMode = 'dark' | 'light';

export interface ThemeColors {
  bg: string;
  bgSecondary: string;
  bgTertiary: string;
  bgInput: string;
  bgCode: string;
  bgCodeAlt: string;
  bgCodeDiffAdd: string;
  bgCodeDiffDel: string;
  bgCodeDiffCommon: string;
  bgError: string;
  bgErrorBorder: string;
  bgNav: string;
  bgNavBorder: string;
  bgBadge: string;
  bgCard: string;
  bgCardBorder: string;
  bgCardActiveBorder: string;
  bgMetricBar: string;
  bgDiffToolbar: string;
  bgDiffHalfTitle: string;
  bgTableHeader: string;
  bgTableRowHover: string;
  bgOverlay: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  textLink: string;
  textLinkHover: string;
  textSuccess: string;
  textWarning: string;
  textError: string;
  textNavActive: string;
  textNavInactive: string;
  accent: string;
  accentHover: string;
  accentLight: string;
  success: string;
  warning: string;
  danger: string;
  border: string;
  borderLight: string;
  shadow: string;
  scrollbar: string;
  scrollbarHover: string;
  selection: string;
}

const darkTheme: ThemeColors = {
  bg: '#0d0d1a',
  bgSecondary: '#1a1a2e',
  bgTertiary: '#2d2d44',
  bgInput: '#0d0d1a',
  bgCode: '#0d0d1a',
  bgCodeAlt: '#1a1a2e',
  bgCodeDiffAdd: '#0d2818',
  bgCodeDiffDel: '#2d1a1a',
  bgCodeDiffCommon: '#1a1a2e',
  bgError: '#2d1a1a',
  bgErrorBorder: '#ef4444',
  bgNav: '#1a1a2e',
  bgNavBorder: '#2d2d44',
  bgBadge: '#4a9eff',
  bgCard: '#1a1a2e',
  bgCardBorder: '#2d2d44',
  bgCardActiveBorder: '#4a9eff',
  bgMetricBar: '#2d2d44',
  bgDiffToolbar: '#1a1a2e',
  bgDiffHalfTitle: '#1a1a2e',
  bgTableHeader: '#1a1a2e',
  bgTableRowHover: '#1a1a2e',
  bgOverlay: 'rgba(0,0,0,0.5)',
  text: '#e0e0e0',
  textSecondary: '#a0a0b0',
  textTertiary: '#606070',
  textLink: '#4a9eff',
  textLinkHover: '#6db3ff',
  textSuccess: '#34d399',
  textWarning: '#f59e0b',
  textError: '#ef4444',
  textNavActive: '#ffffff',
  textNavInactive: '#a0a0b0',
  accent: '#4a9eff',
  accentHover: '#6db3ff',
  accentLight: '#1a2a4e',
  success: '#34d399',
  warning: '#fbbf24',
  danger: '#ef4444',
  border: '#2d2d44',
  borderLight: '#3d3d5c',
  shadow: '0 2px 8px rgba(0,0,0,0.3)',
  scrollbar: '#2d2d44',
  scrollbarHover: '#3d3d5c',
  selection: 'rgba(74,158,255,0.3)',
};

const lightTheme: ThemeColors = {
  bg: '#f5f5f5',
  bgSecondary: '#ffffff',
  bgTertiary: '#e5e7eb',
  bgInput: '#ffffff',
  bgCode: '#f8f9fa',
  bgCodeAlt: '#f0f0f0',
  bgCodeDiffAdd: '#d1fae5',
  bgCodeDiffDel: '#fee2e2',
  bgCodeDiffCommon: '#f0f0f0',
  bgError: '#fef2f2',
  bgErrorBorder: '#ef4444',
  bgNav: '#ffffff',
  bgNavBorder: '#e5e7eb',
  bgBadge: '#3b82f6',
  bgCard: '#ffffff',
  bgCardBorder: '#e5e7eb',
  bgCardActiveBorder: '#3b82f6',
  bgMetricBar: '#e5e7eb',
  bgDiffToolbar: '#f0f0f0',
  bgDiffHalfTitle: '#f0f0f0',
  bgTableHeader: '#f0f0f0',
  bgTableRowHover: '#f9fafb',
  bgOverlay: 'rgba(0,0,0,0.3)',
  text: '#1f2937',
  textSecondary: '#6b7280',
  textTertiary: '#9ca3af',
  textLink: '#3b82f6',
  textLinkHover: '#2563eb',
  textSuccess: '#059669',
  textWarning: '#d97706',
  textError: '#dc2626',
  textNavActive: '#1f2937',
  textNavInactive: '#6b7280',
  accent: '#3b82f6',
  accentHover: '#2563eb',
  accentLight: '#eff6ff',
  success: '#059669',
  warning: '#f59e0b',
  danger: '#dc2626',
  border: '#e5e7eb',
  borderLight: '#d1d5db',
  shadow: '0 2px 8px rgba(0,0,0,0.08)',
  scrollbar: '#d1d5db',
  scrollbarHover: '#9ca3af',
  selection: 'rgba(59,130,246,0.3)',
};

export const themes: Record<ThemeMode, ThemeColors> = { dark: darkTheme, light: lightTheme };

// ─── Detect system preference ───────────────────────────────────────────────

function detectSystemTheme(): ThemeMode {
  if (typeof window !== 'undefined' && window.matchMedia) {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  }
  return 'dark';
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface ThemeContextType {
  mode: ThemeMode;
  colors: ThemeColors;
  toggle: () => void;
  setMode: (mode: ThemeMode | ((prev: ThemeMode) => ThemeMode)) => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    try {
      const stored = localStorage.getItem('promptsentry-theme');
      if (stored === 'light' || stored === 'dark') return stored;
    } catch { /* ignore */ }
    return detectSystemTheme();
  });

  const colors = themes[mode];

  const setMode = useCallback((m: ThemeMode | ((prev: ThemeMode) => ThemeMode)) => {
    setModeState(prev => {
      const next = typeof m === 'function' ? (m as (prev: ThemeMode) => ThemeMode)(prev) : m;
      try { localStorage.setItem('promptsentry-theme', next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const toggle = useCallback(() => {
    setMode((prev: ThemeMode) => (prev === 'dark' ? 'light' : 'dark'));
  }, [setMode]);

  // Apply CSS custom properties
  useEffect(() => {
    const root = document.documentElement;
    const c = themes[mode];
    const vars: Record<string, string> = {};
    for (const [key, value] of Object.entries(c)) {
      vars[`--${key}`] = value;
    }
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
  }, [mode]);

  // Listen for system theme changes
  useEffect(() => {
    try {
      const stored = localStorage.getItem('promptsentry-theme');
      if (stored) return; // User has explicitly set a preference
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => {
        setModeState(detectSystemTheme());
      };
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    } catch { /* ignore */ }
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, colors, toggle, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
