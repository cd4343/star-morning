import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;  // 新增：固定在底部的操作按钮
  className?: string;
}

export const BottomSheet: React.FC<BottomSheetProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  className = ''
}) => {
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleId = useRef(`bottomsheet-title-${Math.random().toString(36).substr(2, 9)}`).current;

  // 点击外部关闭 - 移除，遮罩层的 onClick 已处理
  useEffect(() => {
    if (isOpen) {
      // 禁止背景滚动
      document.body.style.overflow = 'hidden';
      // 聚焦到抽屉
      sheetRef.current?.focus();
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // ESC 关闭
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-end justify-center" role="presentation">
      {/* 遮罩层 */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />
      
      {/* 底部抽屉 - 使用 calc 确保不超出屏幕 */}
      <div 
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative w-full max-w-md bg-white rounded-t-3xl shadow-2xl animate-in slide-in-from-bottom duration-300 flex flex-col outline-none ${className}`}
        style={{ maxHeight: 'calc(100vh - env(safe-area-inset-top, 0px) - 20px)' }}
      >
        {/* 拖动指示器 */}
        <div className="flex-shrink-0 flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 bg-gray-300 rounded-full" aria-hidden="true" />
        </div>
        
        {/* 标题栏 */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 pb-3 border-b">
          <h3 id={titleId} className="font-bold text-lg">{title}</h3>
          <button 
            onClick={onClose}
            className="p-2 -mr-2 hover:bg-gray-100 rounded-full transition-colors"
            aria-label="关闭"
          >
            <X size={20} className="text-gray-500" aria-hidden="true" />
          </button>
        </div>
        
        {/* 内容区域 - 可滚动，flex-1 让它填充剩余空间 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
          {children}
        </div>
        
        {/* 底部操作栏 - 固定在底部，支持安全区域 */}
        {footer && (
          <div className="flex-shrink-0 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t bg-white">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

export default BottomSheet;

