import React, { useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { t } from '../i18n';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  showCloseButton?: boolean;
  closeOnBackdrop?: boolean;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, showCloseButton = true, closeOnBackdrop = true }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = useRef(`modal-title-${Math.random().toString(36).substr(2, 9)}`).current;

  // ESC 键关闭
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  // 打开时聚焦 Modal 并禁止背景滚动
  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      modalRef.current?.focus();
      document.body.style.overflow = 'hidden';
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        document.body.style.overflow = '';
      };
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  // 挂到设备框（父子两端通用）：页面内容在 relative + overflow 的滚动容器内，
  // absolute inset-0 直接渲染会以长内容为基准而错位；portal 到设备框使定位基准恢复为可视区。
  const portalTarget = typeof document !== 'undefined'
    ? document.querySelector<HTMLElement>('[data-child-app-frame="true"], [data-app-frame="true"]') || document.body
    : null;

  const overlay = (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={closeOnBackdrop ? onClose : undefined}
      role="presentation"
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col animate-in zoom-in-95 duration-200 outline-none"
        style={{ maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 32px)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex-shrink-0 flex justify-between items-center p-4 border-b">
          <h3 id={titleId} className="font-bold text-lg text-gray-800">{title}</h3>
          {showCloseButton && (
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-100 rounded-full transition-colors"
              aria-label="关闭"
            >
              <X size={20} className="text-gray-500" />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {children}
        </div>
      </div>
    </div>
  );

  return portalTarget ? createPortal(overlay, portalTarget) : overlay;
};

interface ConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    content: string;
    confirmText?: string;
    cancelText?: string;
    isDanger?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({ isOpen, onClose, onConfirm, title, content, confirmText = t('common.confirm'), cancelText = t('common.cancel'), isDanger=false }) => {
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={title} showCloseButton={false}>
            <div className="mb-6 text-gray-600">{content}</div>
            <div className="flex gap-3">
                <button onClick={onClose} className="flex-1 py-2.5 bg-gray-100 font-bold text-gray-600 rounded-xl hover:bg-gray-200 transition-colors">
                    {cancelText}
                </button>
                <button onClick={() => { onConfirm(); onClose(); }} className={`flex-1 py-2.5 font-bold text-white rounded-xl shadow-lg transition-transform active:scale-95 ${isDanger ? 'bg-red-500 hover:bg-red-600 shadow-red-200' : 'bg-blue-500 hover:bg-blue-600 shadow-blue-200'}`}>
                    {confirmText}
                </button>
            </div>
        </Modal>
    )
}

interface InputModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (value: string) => void;
    title: string;
    placeholder?: string;
    defaultValue?: string;
    type?: string;
}

export const InputModal: React.FC<InputModalProps> = ({ isOpen, onClose, onConfirm, title, placeholder, defaultValue='', type='text' }) => {
    const [value, setValue] = React.useState(defaultValue);

    // Reset value when open
    useEffect(() => { if(isOpen) setValue(defaultValue); }, [isOpen, defaultValue]);

    const handleSubmit = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!value.trim()) return;
        onConfirm(value);
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={title}>
            <form onSubmit={handleSubmit}>
                <input
                    autoFocus
                    type={type}
                    className="w-full p-3 bg-gray-100 rounded-xl outline-none focus:ring-2 ring-blue-500 mb-6 text-lg"
                    placeholder={placeholder}
                    value={value}
                    onChange={e => setValue(e.target.value)}
                />
                <div className="flex gap-3">
                    <button type="button" onClick={onClose} className="flex-1 py-2.5 bg-gray-100 font-bold text-gray-600 rounded-xl hover:bg-gray-200">
                        {t('common.cancel')}
                    </button>
                    <button type="submit" disabled={!value.trim()} className="flex-1 py-2.5 bg-blue-600 font-bold text-white rounded-xl shadow-lg shadow-blue-200 disabled:bg-gray-300 disabled:shadow-none">
                        {t('common.confirm')}
                    </button>
                </div>
            </form>
        </Modal>
    )
}

// 孩子性别选项
const CHILD_GENDERS = [
    { value: 'boy', label: '男孩', avatar: '👦' },
    { value: 'girl', label: '女孩', avatar: '👧' },
];

interface AddEditChildModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (data: { name: string, birthdate: string, gender: string }) => void;
    title: string;
    initialData?: { name: string, birthdate: string, gender?: string };
}

export const AddEditChildModal: React.FC<AddEditChildModalProps> = ({ isOpen, onClose, onConfirm, title, initialData }) => {
    const [name, setName] = React.useState('');
    const [birthdate, setBirthdate] = React.useState('');
    const [gender, setGender] = React.useState('boy');

    useEffect(() => {
        if (isOpen) {
            setName(initialData?.name || '');
            setBirthdate(initialData?.birthdate || '');
            setGender(initialData?.gender || 'boy');
        }
    }, [isOpen, initialData]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        onConfirm({ name, birthdate, gender });
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={title}>
            <form onSubmit={handleSubmit} className="space-y-4">
                {/* 性别选择 */}
                <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">孩子性别</label>
                    <div className="flex gap-3">
                        {CHILD_GENDERS.map(g => (
                            <button
                                key={g.value}
                                type="button"
                                onClick={() => setGender(g.value)}
                                className={`flex-1 py-3 rounded-xl font-bold transition-all ${
                                    gender === g.value
                                        ? 'bg-green-500 text-white shadow-lg shadow-green-200'
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                }`}
                            >
                                <span className="text-xl mr-1">{g.avatar}</span>
                                {g.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">孩子昵称</label>
                    <input
                        type="text"
                        className="w-full p-3 bg-gray-100 rounded-xl outline-none focus:ring-2 ring-blue-500"
                        placeholder="例如：小明"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        required
                    />
                </div>
                <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">出生日期 (选填)</label>
                    {/* 日期选择器 - 增强移动端可点击性 */}
                    <div className="relative">
                        <input
                            type="date"
                            className="w-full p-3 bg-gray-100 rounded-xl outline-none focus:ring-2 ring-blue-500 appearance-none cursor-pointer"
                            value={birthdate}
                            onChange={e => setBirthdate(e.target.value)}
                            style={{ colorScheme: 'light' }}
                        />
                        {!birthdate && (
                            <div className="absolute inset-0 flex items-center px-3 pointer-events-none text-gray-400">
                                📅 点击选择出生日期
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex gap-3 pt-4">
                    <button type="button" onClick={onClose} className="flex-1 py-2.5 bg-gray-100 font-bold text-gray-600 rounded-xl hover:bg-gray-200">
                        {t('common.cancel')}
                    </button>
                    <button type="submit" disabled={!name.trim()} className="flex-1 py-2.5 bg-blue-600 font-bold text-white rounded-xl shadow-lg shadow-blue-200 disabled:bg-gray-300 disabled:shadow-none">
                        保存
                    </button>
                </div>
            </form>
        </Modal>
    );
};
