import React, { useEffect, useRef, useCallback, useState } from 'react';

export interface ShortcutOptions {
  combo: string;       // e.g. 'ctrl+n', 'meta+k', 'ctrl+shift+r'
  action: () => void;
  description?: string;
  enabled?: boolean;   // if false, skip this shortcut (default true)
}

/**
 * Hook that registers global keyboard shortcuts.
 * Supports: ctrl, meta, shift, alt modifiers and any key.
 * Examples: 'ctrl+n', 'meta+k', 'ctrl+shift+r', 'escape'
 */
export function useKeyboardShortcuts(shortcuts: ShortcutOptions[]) {
  const handlersRef = useRef<Map<string, () => void>>(new Map());

  // Keep handlers current
  shortcuts.forEach(s => {
    if (s.enabled === false) return;
    handlersRef.current.set(s.combo, s.action);
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const parts: string[] = [];
      if (e.ctrlKey) parts.push('ctrl');
      if (e.metaKey) parts.push('meta');
      if (e.shiftKey) parts.push('shift');
      if (e.altKey) parts.push('alt');
      parts.push(e.key.toLowerCase());
      const combo = parts.join('+');

      const action = handlersRef.current.get(combo);
      if (action) {
        e.preventDefault();
        action();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}

/**
 * Hook for a single shortcut.
 */
export function useShortcut(options: Omit<ShortcutOptions, 'combo'> & { combo: string }) {
  const ref = useRef(options.action);
  ref.current = options.action;

  useEffect(() => {
    if (options.enabled === false) return;
    const handler = (e: KeyboardEvent) => {
      const parts: string[] = [];
      if (e.ctrlKey) parts.push('ctrl');
      if (e.metaKey) parts.push('meta');
      if (e.shiftKey) parts.push('shift');
      if (e.altKey) parts.push('alt');
      parts.push(e.key.toLowerCase());
      const combo = parts.join('+');
      if (combo === options.combo) {
        e.preventDefault();
        ref.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [options.combo, options.enabled]);
}

/**
 * Detects platform and returns the display name for modifier keys.
 */
export function usePlatformShortcuts(): { ctrl: string; meta: string; shift: string; alt: string } {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  return {
    ctrl: isMac ? '⌃' : 'Ctrl',
    meta: isMac ? '⌘' : 'Ctrl',
    shift: isMac ? '⇧' : 'Shift',
    alt: isMac ? '⌥' : 'Alt',
  };
}

/**
 * Hook that shows a toast notification.
 * Returns { toast, showToast, dismiss } — call showToast(msg, type?) to show, dismiss() to hide.
 */
export function useToast() {
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    setToast(null);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    dismiss();
    setToast({ message, type });
    timerRef.current = setTimeout(dismiss, 3000);
  }, [dismiss]);

  return { toast, showToast, dismiss };
}
