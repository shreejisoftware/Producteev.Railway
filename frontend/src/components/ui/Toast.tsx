import { useState, useEffect, useCallback, createContext, useContext, useRef, useMemo, type ReactNode } from 'react';
import { useAppSelector } from '../../store';

// ─── Types ───────────────────────────────────────────────────────
type ToastType = 'success' | 'error' | 'warning' | 'info' | 'notification';
type NotificationPosition = 'top-right' | 'bottom-right';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
  sender?: {
    name: string;
    avatar?: string;
  };
  websiteIcon?: string;
  websiteName?: string;
  title?: string;
}

interface ToastContextValue {
  toast: (type: ToastType, message: string, opts?: { duration?: number; action?: { label: string; onClick: () => void }; sender?: { name: string; avatar?: string }; websiteIcon?: string; websiteName?: string; title?: string }) => void;
  success: (message: string) => void;
  error: (message: string, opts?: { action?: { label: string; onClick: () => void } }) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
  notification: (message: string, opts?: { sender?: { name: string; avatar?: string }; websiteIcon?: string; websiteName?: string; title?: string; duration?: number; action?: { label: string; onClick: () => void } }) => void;
  dismiss: (id: string) => void;
}

// ─── Context ─────────────────────────────────────────────────────
const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

// ─── Icons ───────────────────────────────────────────────────────
const ICONS: Record<ToastType, () => ReactNode> = {
  success: () => (
    <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  error: () => (
    <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  warning: () => (
    <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
    </svg>
  ),
  info: () => (
    <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  notification: () => (
    <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  ),
};

const BG_STYLES: Record<ToastType, string> = {
  success: 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/30',
  error: 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30',
  warning: 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30',
  info: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30',
  notification: 'border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/30',
};

// ─── Single Toast Item ───────────────────────────────────────────
function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => onDismiss(toast.id), 200);
  }, [toast.id, onDismiss]);

  useEffect(() => {
    const dur = toast.duration ?? (toast.type === 'error' ? 6000 : 4000);
    timerRef.current = setTimeout(dismiss, dur);
    return () => clearTimeout(timerRef.current);
  }, [toast.duration, toast.type, dismiss]);

  const hasNotificationMeta = toast.sender || toast.websiteName || toast.websiteIcon || toast.title;

  if (hasNotificationMeta) {
    return (
      <div
        className={`flex flex-col w-full max-w-md rounded-2xl border shadow-2xl backdrop-blur-sm transition-all duration-200 overflow-hidden ${BG_STYLES[toast.type]} ${
          exiting ? 'opacity-0 translate-x-8 scale-95' : 'opacity-100 translate-x-0 scale-100 animate-toast-pop'
        }`}
      >
        {/* Main content */}
        <div className="relative flex gap-3 px-4 py-4">
          <button
            onClick={dismiss}
            className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          {/* Sender avatar or fallback */}
          <div className="shrink-0">
            {toast.sender?.avatar ? (
              <img src={toast.sender.avatar} alt={toast.sender.name} className="w-12 h-12 rounded-full object-cover border-2 border-current border-opacity-20" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold text-lg border-2 border-current border-opacity-20">
                {toast.sender?.name ? toast.sender.name.charAt(0).toUpperCase() : (toast.websiteName?.charAt(0).toUpperCase() || 'N')}
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Title if provided */}
            {toast.title && (
              <p className="text-sm font-bold text-gray-900 dark:text-white mb-1">
                {toast.title}
              </p>
            )}

            {/* Sender name if available */}
            {toast.sender?.name && (
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">{toast.sender.name}</p>
            )}

            {/* Message */}
            <p className="text-sm text-gray-700 dark:text-gray-200 leading-snug break-words">{toast.message}</p>

            {/* Action button if provided */}
            {toast.action && (
              <button
                onClick={() => { toast.action!.onClick(); dismiss(); }}
                className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline mt-2"
              >
                {toast.action.label}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Simple notification without sender info
  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-sm max-w-sm w-full transition-all duration-200 ${BG_STYLES[toast.type]} ${
        exiting ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0 animate-slide-in-right'
      }`}
    >
      <div className="shrink-0 mt-0.5">{ICONS[toast.type]()}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-white">{toast.message}</p>
        {toast.action && (
          <button
            onClick={() => { toast.action!.onClick(); dismiss(); }}
            className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline mt-1"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        onClick={dismiss}
        className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ─── Provider ────────────────────────────────────────────────────
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const currentUser = useAppSelector((state) => state.user.currentUser);
  
  // Get notification position from user settings
  const notificationPosition: NotificationPosition = 
    ((currentUser?.settings as any)?.notifications?.notificationPosition as NotificationPosition) || 'top-right';

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((type: ToastType, message: string, opts?: { duration?: number; action?: { label: string; onClick: () => void }; sender?: { name: string; avatar?: string }; websiteIcon?: string; websiteName?: string; title?: string }) => {
    const id = `toast-${++idRef.current}`;
    setToasts((prev) => [...prev.slice(-4), { id, type, message, ...opts }]);
  }, []);

  const value: ToastContextValue = useMemo(() => ({
    toast: addToast,
    success: (msg: string) => addToast('success', msg),
    error: (msg: string, opts?: { action?: { label: string; onClick: () => void } }) => addToast('error', msg, opts),
    warning: (msg: string) => addToast('warning', msg),
    info: (msg: string) => addToast('info', msg),
    notification: (msg: string, opts?: { sender?: { name: string; avatar?: string }; websiteIcon?: string; websiteName?: string; title?: string; duration?: number; action?: { label: string; onClick: () => void } }) => addToast('notification', msg, opts),
    dismiss,
  }), [addToast, dismiss]);

  // Determine position classes based on user preference
  const positionClasses = notificationPosition === 'bottom-right' 
    ? 'fixed bottom-4 right-4' 
    : 'fixed top-4 right-4';

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast container */}
      <div className={`${positionClasses} z-[200] flex flex-col gap-3 pointer-events-none`}>
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
