import { useState } from 'react';
import { Confetti } from './Confetti';
import Mascot from './Mascot';
import { getLevelProgress, getLevelStage } from '../utils/levelPerks';
import { t } from '../i18n';

interface LevelUpModalProps {
  level: number;
  totalXp: number;
  onClose: () => void;
}

const STAR_DECORATIONS = [
  { top: '12%', left: '14%', size: 14, delay: '0s' },
  { top: '20%', left: '78%', size: 10, delay: '0.4s' },
  { top: '34%', left: '8%', size: 8, delay: '0.8s' },
  { top: '8%', left: '52%', size: 9, delay: '1.2s' },
  { top: '42%', left: '88%', size: 12, delay: '0.6s' },
];

export default function LevelUpModal({ level, totalXp, onClose }: LevelUpModalProps) {
  const [confettiActive, setConfettiActive] = useState(true);
  const stage = getLevelStage(level);
  const progress = getLevelProgress(totalXp);

  return (
    <div
      className="fixed inset-0 z-[120] flex flex-col items-center justify-center bg-gradient-to-b from-slate-900 to-indigo-900 px-6 pt-[env(safe-area-inset-top)] pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      role="dialog"
      aria-label={t('growthIdentity.levelUpDialog')}
    >
      <Confetti active={confettiActive} duration={3500} onComplete={() => setConfettiActive(false)} />
      {STAR_DECORATIONS.map((star, index) => (
        <span
          key={index}
          className="levelup-star absolute select-none text-yellow-200 pointer-events-none"
          style={{ top: star.top, left: star.left, fontSize: star.size, animationDelay: star.delay }}
        >
          ✦
        </span>
      ))}

      <div className="levelup-pop text-center">
        <Mascot variant="celebrate" size={96} className="mx-auto mb-3" />
        <div className="text-sm font-black tracking-[0.3em] text-yellow-200/80">{t('growthIdentity.levelUp')}</div>
        <div className="mt-2 bg-gradient-to-b from-yellow-200 via-amber-300 to-orange-400 bg-clip-text text-[88px] font-black leading-none text-transparent drop-shadow-[0_4px_12px_rgba(251,191,36,0.45)]">
          Lv.{level}
        </div>
        <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-5 py-2 backdrop-blur-sm">
          <span className="text-base">✦</span>
          <span className="text-lg font-black text-yellow-100">{t(stage.titleKey)}</span>
        </div>
      </div>

      <div className="levelup-detail mt-6 w-full max-w-xs rounded-3xl border border-white/20 bg-white/10 p-4 text-center backdrop-blur-sm">
        <div className="text-xs font-bold leading-relaxed text-white/75">{t(stage.meaningKey)}</div>
        <div className="mt-2 text-sm font-black text-white">
          {t('growthIdentity.nextLevelDistance', { remaining: progress.remainingXp })}
        </div>
      </div>

      <button
        type="button"
        onClick={onClose}
        className="levelup-btn mt-10 min-h-[56px] w-full max-w-xs rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 text-lg font-black text-white shadow-xl shadow-amber-500/30 transition-transform active:scale-95"
      >
        {t('growthIdentity.levelUpClose')}
      </button>

      <style>{`
        @keyframes levelup-pop-in { 0% { opacity: 0; transform: scale(0.6) translateY(24px); } 60% { opacity: 1; transform: scale(1.08) translateY(-4px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes levelup-rise-in { 0% { opacity: 0; transform: translateY(20px); } 100% { opacity: 1; transform: translateY(0); } }
        @keyframes levelup-twinkle { 0%, 100% { opacity: 0.25; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.2); } }
        .levelup-pop { animation: levelup-pop-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
        .levelup-detail { animation: levelup-rise-in 0.5s ease-out 0.35s both; }
        .levelup-btn { animation: levelup-rise-in 0.5s ease-out 0.55s both; }
        .levelup-star { animation: levelup-twinkle 2.2s ease-in-out infinite; }
      `}</style>
    </div>
  );
}
