import { ArrowRight, LogIn } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../../i18n';

export const WELCOME_SEEN_KEY = 'starhope_welcome_seen';

export default function Welcome() {
  const navigate = useNavigate();
  const [imageAvailable, setImageAvailable] = useState(true);

  const continueTo = (path: '/register' | '/login') => {
    try {
      localStorage.setItem(WELCOME_SEEN_KEY, '1');
    } catch {
      // Storage can be unavailable in private browsing; navigation must still work.
    }
    navigate(path);
  };

  return (
    <main className="flex min-h-[100dvh] justify-center overflow-hidden bg-[#05172b]">
      <section className="relative isolate min-h-[100dvh] w-full max-w-[520px] overflow-hidden bg-[#0a3156] shadow-2xl shadow-black/40">
        <h1 className="sr-only">{t('welcome.title')}</h1>
        {imageAvailable ? (
          <img
            src="/starhope-welcome.webp"
            alt={t('welcome.imageAlt')}
            className="absolute inset-0 h-full w-full object-cover object-center"
            onError={() => setImageAvailable(false)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_top,#16578a_0%,#071c34_60%,#04101e_100%)] px-8 text-center">
            <div>
              <div className="text-6xl" aria-hidden="true">✨</div>
              <div className="mt-5 text-4xl font-black tracking-[0.22em] text-amber-100">
                {t('welcome.title')}
              </div>
            </div>
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 h-[42%] bg-gradient-to-t from-[#04111f] via-[#04111f]/75 to-transparent" aria-hidden="true" />

        <div className="absolute inset-x-0 bottom-0 z-10 px-5 pb-[max(24px,env(safe-area-inset-bottom))]">
          <p className="mb-4 text-center text-sm font-bold tracking-wide text-white/90">
            {t('welcome.tagline')}
          </p>
          <button
            type="button"
            onClick={() => continueTo('/register')}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#f7d38b] to-[#f1b85d] px-5 py-3.5 text-base font-black text-[#132d48] shadow-lg shadow-black/25 transition active:scale-[0.98]"
          >
            {t('welcome.start')} <ArrowRight size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => continueTo('/login')}
            className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/25 bg-[#08223b]/75 px-5 py-3 text-sm font-bold text-white backdrop-blur-md transition active:scale-[0.98]"
          >
            <LogIn size={18} aria-hidden="true" /> {t('welcome.login')}
          </button>
        </div>
      </section>
    </main>
  );
}
