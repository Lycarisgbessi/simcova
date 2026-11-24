import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  description?: string;
}

export const ToastContainer: React.FC<{
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}> = ({ toasts, onDismiss }) => {
  return (
    <div
      aria-live="polite"
      className="fixed bottom-16 sm:bottom-5 left-4 right-4 sm:left-5 sm:right-auto z-[var(--sim-z-toast)] flex flex-col gap-2 sm:max-w-xs w-auto sm:w-full pointer-events-none"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-auto flex items-start gap-2.5 rounded-[var(--sim-radius-md)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-surface)] p-3 shadow-[var(--sim-shadow-3)]"
          >
            {t.type === 'success' && <CheckCircle2 className="w-5 h-5 shrink-0 text-[var(--sim-success-text)] mt-0.5" />}
            {t.type === 'error' && <AlertTriangle className="w-5 h-5 shrink-0 text-[var(--sim-error-text)] mt-0.5" />}
            {t.type === 'info' && <Info className="w-5 h-5 shrink-0 text-[var(--sim-accent-500)] mt-0.5" />}
            <div className="flex-1 min-w-0">
              <p className="font-display text-sm font-semibold text-[var(--sim-text-primary)]">{t.title}</p>
              {t.description && (
                <p className="text-xs text-[var(--sim-text-secondary)] mt-0.5 leading-relaxed">{t.description}</p>
              )}
            </div>
            <button
              type="button"
              aria-label="Fermer la notification"
              onClick={() => onDismiss(t.id)}
              className="p-1 text-[var(--sim-text-muted)] hover:text-[var(--sim-text-primary)] rounded-[var(--sim-radius-sm)] transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
