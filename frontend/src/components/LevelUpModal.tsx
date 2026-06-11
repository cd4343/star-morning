import { useState } from 'react';
import { Confetti } from './Confetti';
import { getLevelTitle, PERK_MILESTONES } from '../utils/levelPerks';

// R3: 升级庆祝全屏弹窗（纯展示，关闭后不影响任何功能）
// TODO i18n: 文案后续迁移到 t('key')
interface LevelUpModalProps {
  level: number;
  onClose: () => void;
}

const STAR_DECORATIONS = [
  { top: '12%', left: '14%', size: 14, delay: '0s' },
  { top: '20%', left: '78%', size: 10, delay: '0.4s' },
  { top: '34%', left: '8%', size: 8, delay: '0.8s' },
  { top: '8%', left: '52%', size: 9, delay: '1.2s' },
  { top: '42%', left: '88%', size: 12, delay: '0.6s' },
  { top: '70%', left: '10%', size: 10, delay: '1s' },
  { top: '78%', left: '82%', size: 9, delay: '0.2s' },
];

export default function LevelUpModal({ level, onClose }: LevelUpModalProps) {
  const [confettiActive, setConfettiActive] = useState(true);
  const unlockedPerk = PERK_MILESTONES.find(p => p.level === level);

  return (
    <div
      className="fixed inset-0 z-[120] flex flex-col items-center justify-center bg-gradient-to-b from-slate-900 to-indigo-900 px-6"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
      role="dialog"
      aria-label="升级庆祝"
    >
      <Confetti active={confettiActive} duration={3500} onComplete={() => setConfettiActive(false)} />

      {/* 星空闪烁装饰 */}
      {STAR_DECORATIONS.map((star, i) => (
        <span
          key={i}
          className="levelup-star absolute text-yellow-200 pointer-events-none select-none"
          style={{ top: star.top, left: star.left, fontSize: star.size, animationDelay: star.delay }}
        >
          ✦
        </span>
      ))}

      <div className="levelup-pop text-center">
        <div className="text-sm font-black tracking-[0.3em] text-yellow-200/80">升级啦！</div>
        <div className="mt-2 text-[88px] leading-none font-black text-transparent bg-clip-text bg-gradient-to-b from-yellow-200 via-amber-300 to-orange-400 drop-shadow-[0_4px_12px_rgba(251,191,36,0.45)]">
          Lv.{level}
        </div>
        <div className="mt-4 inline-flex items-center gap-2 px-5 py-2 rounded-full bg-white/10 border border-white/25 backdrop-blur-sm">
          <span className="text-base">🌟</span>
          <span className="text-lg font-black text-yellow-100">{getLevelTitle(level)}</span>
        </div>
      </div>

      {unlockedPerk && (
        <div className="levelup-perk mt-6 w-full max-w-xs rounded-3xl bg-white/10 border border-white/20 backdrop-blur-sm p-4 text-center">
          <div className="text-[10px] font-black tracking-widest text-amber-300">
            {unlockedPerk.status === 'coming' ? '新里程碑' : '新权益'}
          </div>
          <div className="mt-1 text-3xl">{unlockedPerk.icon}</div>
          <div className="mt-1 text-base font-black text-white">解锁：{unlockedPerk.title}</div>
          <div className="mt-1 text-xs leading-relaxed text-white/70">{unlockedPerk.desc}</div>
        </div>
      )}

      <button
        type="button"
        onClick={onClose}
        className="levelup-btn mt-10 w-full max-w-xs min-h-[56px] rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 text-white text-lg font-black shadow-xl shadow-amber-500/30 active:scale-95 transition-transform"
      >
        太棒了，继续前进！
      </button>

      <style>{`
        @keyframes levelup-pop-in {
          0% { opacity: 0; transform: scale(0.6) translateY(24px); }
          60% { opacity: 1; transform: scale(1.08) translateY(-4px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes levelup-rise-in {
          0% { opacity: 0; transform: translateY(20px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes levelup-twinkle {
          0%, 100% { opacity: 0.25; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.2); }
        }
        .levelup-pop { animation: levelup-pop-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
        .levelup-perk { animation: levelup-rise-in 0.5s ease-out 0.35s both; }
        .levelup-btn { animation: levelup-rise-in 0.5s ease-out 0.55s both; }
        .levelup-star { animation: levelup-twinkle 2.2s ease-in-out infinite; }
      `}</style>
    </div>
  );
}
