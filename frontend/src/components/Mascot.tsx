// 小晨星：Star Coin 吉祥物（圆润胖五角星），五种表情全部为手写内联 SVG，无外部资源
// 纯装饰插画：aria-hidden，含义由相邻文案表达，因此无用户可见字符串、无需 i18n
export type MascotVariant = 'calm' | 'happy' | 'cheer' | 'sleep' | 'celebrate';

interface MascotProps {
  variant: MascotVariant;
  size: number;
  className?: string;
}

// 共用星形主体：顶点与凹角均用二次贝塞尔圆角（无尖锐折线），内半径取胖比例
const BODY_PATH =
  'M55 24.76 Q60 16 65 24.76 L70.29 34.04 Q74.7 41.77 83.42 43.58 ' +
  'L93.87 45.74 Q103.75 47.79 96.96 55.25 L89.77 63.15 Q83.78 69.73 84.76 78.57 ' +
  'L85.93 89.19 Q87.04 99.21 77.85 95.06 L68.11 90.66 Q60 87 51.89 90.66 ' +
  'L42.15 95.06 Q32.96 99.21 34.07 89.19 L35.24 78.57 Q36.22 69.73 30.23 63.15 ' +
  'L23.04 55.25 Q16.25 47.79 26.13 45.74 L36.58 43.58 Q45.3 41.77 49.71 34.04 Z';

const BODY = '#FBBF24'; // 主体杏黄（= var(--sc-star)）
const LINE = '#92400E'; // 描边深棕
const BLUSH = '#FDA4AF'; // 腮红粉

function StarBody() {
  return (
    <g>
      <path d={BODY_PATH} fill={BODY} stroke={LINE} strokeWidth="3" strokeLinejoin="round" />
      {/* 柔和高光：左上弧光 + 小光点 */}
      <path d="M55 30.5 Q56.5 24.5 61.5 22.8" fill="none" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" opacity="0.5" />
      <circle cx="51" cy="37" r="2.2" fill="#FFFFFF" opacity="0.4" />
    </g>
  );
}

function Blush({ size = 4.6, opacity = 0.85 }: { size?: number; opacity?: number }) {
  return (
    <g fill={BLUSH} opacity={opacity}>
      <circle cx="39" cy="67" r={size} />
      <circle cx="81" cy="67" r={size} />
    </g>
  );
}

export function Mascot({ variant, size, className }: MascotProps) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={['sc-mascot', className].filter(Boolean).join(' ')}
      aria-hidden="true"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      <style>{`
        .sc-mascot { display: block; animation: sc-mascot-float 3.2s ease-in-out infinite; }
        @keyframes sc-mascot-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .sc-mascot { animation: none; }
        }
      `}</style>

      {variant === 'calm' && (
        <g>
          <StarBody />
          {/* 微闭眼弧线 + 浅笑 */}
          <g fill="none" stroke={LINE} strokeWidth="3.2" strokeLinecap="round">
            <path d="M40 57.5 Q45.5 62.5 51 57.5" />
            <path d="M69 57.5 Q74.5 62.5 80 57.5" />
            <path d="M53.5 70.5 Q60 75.5 66.5 70.5" />
          </g>
          <Blush />
        </g>
      )}

      {variant === 'happy' && (
        <g>
          <StarBody />
          {/* 头顶小星花 */}
          <path d="M87 9.5 Q88.4 14.6 93.5 16 Q88.4 17.4 87 22.5 Q85.6 17.4 80.5 16 Q85.6 14.6 87 9.5 Z" fill={BODY} stroke={LINE} strokeWidth="1.6" strokeLinejoin="round" />
          {/* 圆睁大眼 + 大笑嘴（含舌头） */}
          <circle cx="46" cy="56.5" r="4.6" fill={LINE} />
          <circle cx="74" cy="56.5" r="4.6" fill={LINE} />
          <circle cx="47.6" cy="55" r="1.5" fill="#FFFFFF" />
          <circle cx="75.6" cy="55" r="1.5" fill="#FFFFFF" />
          <path d="M47.5 67.5 Q60 83 72.5 67.5 Q60 72.5 47.5 67.5 Z" fill={LINE} />
          <path d="M54 71.8 Q60 78 66 71.8 Q60 74.8 54 71.8 Z" fill={BLUSH} />
          <Blush size={3.8} opacity={0.7} />
        </g>
      )}

      {variant === 'cheer' && (
        <g>
          {/* 两侧速度线 */}
          <g stroke={LINE} strokeWidth="3" strokeLinecap="round" opacity="0.4">
            <path d="M2 60 L12 60" />
            <path d="M5 70 L14 70" />
            <path d="M106 64 L116 64" />
            <path d="M103 74 L112 74" />
          </g>
          {/* 整体微倾 8°，右上星角扬起似挥手，角尖配两道挥动弧线 */}
          <g transform="rotate(-8 60 62)">
            <StarBody />
            <g fill="none" stroke={LINE} strokeLinecap="round">
              <path d="M101 35.5 Q106.5 36.5 109.5 41" strokeWidth="2.6" opacity="0.55" />
              <path d="M94 29.5 Q99.5 30 103 33.5" strokeWidth="2.4" opacity="0.45" />
            </g>
            {/* 加油闭眼笑 + 张嘴笑 */}
            <g fill="none" stroke={LINE} strokeWidth="3.2" strokeLinecap="round">
              <path d="M40.5 56.5 Q46 62 51.5 56.5" />
              <path d="M68.5 56.5 Q74 62 79.5 56.5" />
            </g>
            <path d="M49 67 Q60 80 71 67 Q60 71.5 49 67 Z" fill={LINE} />
            <Blush size={3.8} opacity={0.7} />
          </g>
        </g>
      )}

      {variant === 'sleep' && (
        <g>
          <StarBody />
          {/* 头顶小月牙 */}
          <path d="M33 7 A9 9 0 1 0 43 17 A7.6 7.6 0 0 1 33 7 Z" fill="#FDE68A" stroke={LINE} strokeWidth="1.6" strokeLinejoin="round" />
          {/* Zzz：由近及远三个 Z 折线 */}
          <g fill="none" stroke="#6366F1" strokeLinecap="round" strokeLinejoin="round">
            <path d="M84 24 L93 24 L84 33 L93 33" strokeWidth="3" />
            <path d="M96 16 L103 16 L96 23 L103 23" strokeWidth="2.6" />
            <path d="M106 9 L111 9 L106 14 L111 14" strokeWidth="2.2" />
          </g>
          {/* 闭眼 + 打鼾小嘴 */}
          <g fill="none" stroke={LINE} strokeWidth="3.2" strokeLinecap="round">
            <path d="M41 59 Q46 62 51 59" />
            <path d="M69 59 Q74 62 79 59" />
          </g>
          <ellipse cx="60" cy="71.5" rx="3" ry="3.8" fill={LINE} opacity="0.9" />
        </g>
      )}

      {variant === 'celebrate' && (
        <g>
          {/* 彩色小纸屑（circle/rect 共 5 个） */}
          <circle cx="18" cy="20" r="3" fill="#6366F1" />
          <rect x="96" y="13" width="5.5" height="5.5" rx="1.2" fill="#F472B6" transform="rotate(18 98.75 15.75)" />
          <circle cx="108" cy="60" r="2.8" fill="#34D399" />
          <rect x="11" y="74" width="5" height="5" rx="1.2" fill="#60A5FA" transform="rotate(-15 13.5 76.5)" />
          <circle cx="99" cy="90" r="3" fill="#FB923C" />
          <StarBody />
          {/* 星星眼（✦ 形瞳孔）+ 张嘴欢呼（含舌头） */}
          <g fill={LINE}>
            <path d="M45 50.3 Q46.3 55.2 50.8 56.5 Q46.3 57.8 45 62.7 Q43.7 57.8 39.2 56.5 Q43.7 55.2 45 50.3 Z" />
            <path d="M75 50.3 Q76.3 55.2 80.8 56.5 Q76.3 57.8 75 62.7 Q73.7 57.8 69.2 56.5 Q73.7 55.2 75 50.3 Z" />
          </g>
          <ellipse cx="60" cy="73.5" rx="7.5" ry="8" fill={LINE} />
          <ellipse cx="60" cy="77.2" rx="4.2" ry="3.4" fill={BLUSH} />
          <Blush size={3.8} opacity={0.7} />
        </g>
      )}
    </svg>
  );
}

export default Mascot;
