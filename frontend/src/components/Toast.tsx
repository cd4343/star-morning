import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, duration?: number) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const TOAST_CONFIGS = {
  success: {
    icon: CheckCircle,
    bg: 'bg-green-500',
    iconBg: 'bg-green-600',
    ariaLive: 'polite' as const,
  },
  error: {
    icon: XCircle,
    bg: 'bg-red-500',
    iconBg: 'bg-red-600',
    ariaLive: 'assertive' as const,
  },
  warning: {
    icon: AlertTriangle,
    bg: 'bg-orange-500',
    iconBg: 'bg-orange-600',
    ariaLive: 'polite' as const,
  },
  info: {
    icon: Info,
    bg: 'bg-blue-500',
    iconBg: 'bg-blue-600',
    ariaLive: 'polite' as const,
  },
};

// 最大同时显示的 Toast 数量
const MAX_TOASTS = 5;

const ToastItem: React.FC<{ toast: Toast; onRemove: (id: string) => void }> = ({ toast, onRemove }) => {
  const config = TOAST_CONFIGS[toast.type];
  const Icon = config.icon;

  useEffect(() => {
    const timer = setTimeout(() => {
      onRemove(toast.id);
    }, toast.duration || 3000);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onRemove]);

  return (
    <div 
      role="alert"
      aria-live={config.ariaLive}
      className={`${config.bg} text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 animate-in slide-in-from-top-2 duration-200 max-w-sm`}
    >
      <div className={`p-1 rounded-lg ${config.iconBg}`}>
        <Icon size={18} aria-hidden="true" />
      </div>
      <span className="flex-1 text-sm font-medium">{toast.message}</span>
      <button 
        onClick={() => onRemove(toast.id)} 
        className="p-1 hover:bg-white/20 rounded-lg transition-colors"
        aria-label="关闭通知"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
};

// 唯一 ID 计数器
let toastIdCounter = 0;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info', duration = 3000) => {
    // 使用递增计数器确保 ID 唯一
    const id = `toast-${++toastIdCounter}-${Date.now()}`;
    setToasts(prev => {
      const newToasts = [...prev, { id, message, type, duration }];
      // 限制最大数量，移除最旧的
      if (newToasts.length > MAX_TOASTS) {
        return newToasts.slice(-MAX_TOASTS);
      }
      return newToasts;
    });
  }, []);

  const success = useCallback((message: string) => showToast(message, 'success'), [showToast]);
  const error = useCallback((message: string) => showToast(message, 'error', 4000), [showToast]);
  const warning = useCallback((message: string) => showToast(message, 'warning'), [showToast]);
  const info = useCallback((message: string) => showToast(message, 'info'), [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, success, error, warning, info }}>
      {children}
      {/* Toast Container */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map(toast => (
          <div key={toast.id} className="pointer-events-auto">
            <ToastItem toast={toast} onRemove={removeToast} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

export default ToastProvider;

