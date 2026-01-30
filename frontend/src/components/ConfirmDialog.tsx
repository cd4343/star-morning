import React, { useEffect, useRef, useCallback } from 'react';
import { AlertTriangle, Trash2, X, Info } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 确认对话框组件
 * 替代 window.confirm，提供更好的用户体验
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title = '确认操作',
  message,
  confirmText = '确定',
  cancelText = '取消',
  type = 'warning',
  onConfirm,
  onCancel,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useRef(`confirm-title-${Math.random().toString(36).substr(2, 9)}`).current;
  const descId = useRef(`confirm-desc-${Math.random().toString(36).substr(2, 9)}`).current;
  
  // ESC 键关闭
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  }, [onCancel]);
  
  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
      dialogRef.current?.focus();
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        document.body.style.overflow = '';
      };
    }
  }, [isOpen, handleKeyDown]);
  
  if (!isOpen) return null;

  const typeStyles = {
    danger: {
      icon: <Trash2 className="text-red-500" size={24} aria-hidden="true" />,
      iconBg: 'bg-red-100',
      confirmBtn: 'bg-red-500 hover:bg-red-600 text-white',
    },
    warning: {
      icon: <AlertTriangle className="text-orange-500" size={24} aria-hidden="true" />,
      iconBg: 'bg-orange-100',
      confirmBtn: 'bg-orange-500 hover:bg-orange-600 text-white',
    },
    info: {
      icon: <Info className="text-blue-500" size={24} aria-hidden="true" />,
      iconBg: 'bg-blue-100',
      confirmBtn: 'bg-blue-500 hover:bg-blue-600 text-white',
    },
  };

  const styles = typeStyles[type];

  return (
    <div 
      className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onCancel}
      role="presentation"
    >
      <div 
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        className="bg-white rounded-2xl max-w-sm w-full shadow-xl animate-in zoom-in-95 duration-200 outline-none" 
        style={{ maxHeight: 'calc(100vh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 32px)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 flex items-start gap-3">
          <div className={`p-2 rounded-full ${styles.iconBg}`}>
            {styles.icon}
          </div>
          <div className="flex-1">
            <h3 id={titleId} className="font-bold text-gray-800">{title}</h3>
            <p id={descId} className="text-sm text-gray-600 mt-1">{message}</p>
          </div>
          <button 
            onClick={onCancel} 
            className="p-1 hover:bg-gray-100 rounded-full transition-colors"
            aria-label="关闭"
          >
            <X size={20} className="text-gray-400" aria-hidden="true" />
          </button>
        </div>
        
        {/* Actions */}
        <div className="p-4 pt-0 flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-2.5 px-4 font-medium rounded-xl transition-colors ${styles.confirmBtn}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * 确认对话框 Hook
 * 方便管理对话框状态
 */
export function useConfirmDialog() {
  const [isOpen, setIsOpen] = React.useState(false);
  const [config, setConfig] = React.useState<Omit<ConfirmDialogProps, 'isOpen' | 'onConfirm' | 'onCancel'>>({
    message: '',
  });
  const resolveRef = React.useRef<((confirmed: boolean) => void) | null>(null);

  const confirm = React.useCallback((options: {
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    type?: 'danger' | 'warning' | 'info';
  }): Promise<boolean> => {
    setConfig(options);
    setIsOpen(true);
    
    return new Promise((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const handleConfirm = React.useCallback(() => {
    setIsOpen(false);
    resolveRef.current?.(true);
  }, []);

  const handleCancel = React.useCallback(() => {
    setIsOpen(false);
    resolveRef.current?.(false);
  }, []);

  const Dialog = React.useCallback(() => (
    <ConfirmDialog
      isOpen={isOpen}
      {...config}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  ), [isOpen, config, handleConfirm, handleCancel]);

  return {
    confirm,
    Dialog,
    isOpen,
  };
}

export default ConfirmDialog;

