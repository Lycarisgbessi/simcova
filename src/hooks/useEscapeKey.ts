import { useEffect } from 'react';

/**
 * Registers a keydown listener calling `onEscape` when Escape is pressed.
 * Replaces the six previously duplicated inline handlers across modals/drawers.
 */
export function useEscapeKey(onEscape: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onEscape, enabled]);
}
