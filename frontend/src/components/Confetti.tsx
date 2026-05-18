import React, { useEffect, useState } from 'react';

interface ConfettiProps {
  active: boolean;
  duration?: number;
  onComplete?: () => void;
}

export const Confetti: React.FC<ConfettiProps> = ({ active, duration = 3000, onComplete }) => {
  const [particles, setParticles] = useState<Array<{ id: number, x: number, color: string, delay: number, size: number, duration: number }>>([]);

  useEffect(() => {
    if (active) {
      // 生成纸屑粒子
      const colors = ['#fce18a', '#ff726d', '#b48def', '#f4306d', '#42A5F5', '#66BB6A'];
      const newParticles = Array.from({ length: 50 }).map((_, i) => ({
        id: i,
        x: Math.random() * 100, // 0-100vw
        color: colors[Math.floor(Math.random() * colors.length)],
        delay: Math.random() * 0.5,
        size: Math.random() * 10 + 5, // 5-15px
        duration: Math.random() * 2 + 2, // 2-4s
      }));
      setParticles(newParticles);

      const timer = setTimeout(() => {
        setParticles([]);
        if (onComplete) onComplete();
      }, duration);

      return () => clearTimeout(timer);
    } else {
      setParticles([]);
    }
  }, [active, duration, onComplete]);

  if (!active || particles.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-[1000] overflow-hidden">
      {particles.map(p => (
        <div
          key={p.id}
          className="absolute top-[-20px] rounded-sm"
          style={{
            left: `${p.x}vw`,
            width: `${p.size}px`,
            height: `${p.size * 1.5}px`,
            backgroundColor: p.color,
            animation: `confetti-fall ${p.duration}s linear ${p.delay}s forwards, confetti-spin ${p.duration/2}s linear ${p.delay}s infinite`,
            opacity: 1
          }}
        />
      ))}
      <style>{`
        @keyframes confetti-fall {
          0% { top: -20px; transform: translateX(0); opacity: 1; }
          100% { top: 100vh; transform: translateX(20px); opacity: 0; }
        }
        @keyframes confetti-spin {
          0% { transform: rotateX(0) rotateY(0); }
          100% { transform: rotateX(360deg) rotateY(360deg); }
        }
      `}</style>
    </div>
  );
};
