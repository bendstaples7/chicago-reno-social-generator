import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { ErrorResponse } from 'shared';
import { setGlobalErrorListener } from './api';

interface Toast {
  id: number;
  error: ErrorResponse;
}

interface ErrorToastContextValue {
  showError: (error: ErrorResponse) => void;
}

const ErrorToastContext = createContext<ErrorToastContextValue | null>(null);

let nextId = 0;

export function ErrorToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showError = useCallback((error: ErrorResponse) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, error }]);
  }, []);

  // Register as global error listener so API errors auto-show as toasts
  useEffect(() => {
    setGlobalErrorListener(showError);
    return () => setGlobalErrorListener(null);
  }, [showError]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ErrorToastContext.Provider value={{ showError }}>
      {children}
      <div
        aria-live="polite"
        style={{ position: 'fixed', top: 16, right: 16, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 420 }}
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ErrorToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const { id, error } = toast;
  const isWarning = error.severity === 'warning';

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(id), 8000);
    return () => clearTimeout(timer);
  }, [id, onDismiss]);

  return (
    <div
      role="alert"
      style={{
        background: isWarning ? '#fff3e0' : '#fdecea',
        border: `1px solid ${isWarning ? '#ffb74d' : '#ef9a9a'}`,
        borderRadius: 8, padding: '0.75rem 1rem',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        animation: 'fadeIn 0.2s ease',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: isWarning ? '#e65100' : '#b71c1c', marginBottom: 4 }}>
            {error.message}
          </div>
          {error.actions && error.actions.length > 0 && (
            <ul style={{ margin: '4px 0 0', paddingLeft: '1.2rem', fontSize: '0.85rem', color: '#555' }}>
              {error.actions.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          )}
        </div>
        <button
          onClick={() => onDismiss(id)}
          aria-label="Dismiss notification"
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#999', padding: '0 0 0 8px', lineHeight: 1 }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

export function useErrorToast(): ErrorToastContextValue {
  const ctx = useContext(ErrorToastContext);
  if (!ctx) throw new Error('useErrorToast must be used within ErrorToastProvider');
  return ctx;
}
