import React from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from './Button';

interface CreateActionCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  primaryLabel: string;
  onPrimary: () => void;
  tone?: string;
  primaryClassName?: string;
  secondaryLabel?: string;
  secondaryIcon?: React.ReactNode;
  onSecondary?: () => void;
  children?: React.ReactNode;
}

export const CreateActionCard: React.FC<CreateActionCardProps> = ({
  icon,
  title,
  description,
  primaryLabel,
  onPrimary,
  tone = 'from-blue-50 to-indigo-50 border-blue-100',
  primaryClassName = 'bg-blue-600 border-none',
  secondaryLabel,
  secondaryIcon,
  onSecondary,
  children,
}) => {
  const hasSecondary = Boolean(secondaryLabel && onSecondary);

  return (
    <div className={`rounded-2xl bg-gradient-to-br ${tone} border p-4 shadow-sm`}>
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-2xl bg-white/90 flex items-center justify-center text-2xl shadow-sm flex-shrink-0">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-black text-gray-800">{title}</div>
          <div className="text-xs text-gray-500 mt-1 leading-relaxed">{description}</div>
        </div>
      </div>

      {children}

      <div className={`${hasSecondary ? 'grid grid-cols-2' : 'grid grid-cols-1'} gap-2 mt-4`}>
        <Button size="sm" onClick={onPrimary} className={primaryClassName}>
          {primaryLabel}
        </Button>
        {hasSecondary && (
          <Button size="sm" variant="ghost" onClick={onSecondary} className="bg-white/90">
            {secondaryIcon || <Sparkles size={15} />} {secondaryLabel}
          </Button>
        )}
      </div>
    </div>
  );
};

export default CreateActionCard;
