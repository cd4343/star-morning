import { getGrowthIcon, getGrowthIconMilestone, getGrowthIconTone } from '../utils/growthIconRegistry';

type GrowthIconProps = {
  iconKey?: string | null;
  fallback?: string;
  label: string;
  locked?: boolean;
  className?: string;
};

export function GrowthIcon({ iconKey, fallback = '🎖️', label, locked = false, className = '' }: GrowthIconProps) {
  const Icon = getGrowthIcon(iconKey);
  const milestone = getGrowthIconMilestone(iconKey);

  return (
    <span
      role="img"
      aria-label={label}
      className={`relative inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border ${getGrowthIconTone(iconKey)} ${locked ? 'grayscale opacity-60' : ''} ${className}`}
    >
      {Icon ? <Icon size={23} strokeWidth={2.3} aria-hidden="true" /> : <span className="text-2xl" aria-hidden="true">{fallback}</span>}
      {Icon && milestone && (
        <span className="absolute -bottom-1 -right-1 min-w-[18px] rounded-full border-2 border-white bg-slate-800 px-1 text-center text-[8px] font-black leading-[14px] text-white" aria-hidden="true">
          {milestone}
        </span>
      )}
    </span>
  );
}
