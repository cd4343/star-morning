import React from 'react';
import { t } from '../i18n';

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[UI] page render failed', error, info.componentStack);
  }

  private reload = (): void => {
    try {
      sessionStorage.removeItem(`starcoin:chunk-reload:${window.location.pathname}`);
    } catch {
      // Storage may be unavailable in privacy mode; reload still works.
    }
    window.location.reload();
  };

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-5">
        <section className="w-full max-w-sm rounded-3xl border border-white bg-white/95 p-6 text-center shadow-xl">
          <div className="text-5xl" aria-hidden="true">🛠️</div>
          <h1 className="mt-4 text-xl font-black text-slate-800">{t('appError.title')}</h1>
          <p className="mt-2 text-sm font-medium leading-relaxed text-slate-500">{t('appError.message')}</p>
          <button
            type="button"
            onClick={this.reload}
            className="mt-5 min-h-[48px] w-full rounded-2xl bg-blue-600 px-4 font-black text-white active:bg-blue-700"
          >
            {t('appError.reload')}
          </button>
          <a href="/" className="mt-3 flex min-h-[44px] items-center justify-center text-sm font-bold text-slate-500">
            {t('appError.home')}
          </a>
        </section>
      </main>
    );
  }
}
