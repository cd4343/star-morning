import React, { ReactNode, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const ROOT_ROUTES = new Set([
  '/',
  '/login',
  '/register',
  '/select-user',
  '/parent/dashboard',
  '/child/today',
  '/child/challenge',
  '/child/wishes',
  '/child/me',
]);

export const Layout = ({
  children,
  enableSwipeBack = true,
}: {
  children: ReactNode;
  enableSwipeBack?: boolean;
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const canSwipeBack = enableSwipeBack && !ROOT_ROUTES.has(location.pathname);

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!canSwipeBack) return;
    const touch = event.touches[0];
    if (!touch || touch.clientX > 28) return;
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || !canSwipeBack) return;

    const touch = event.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;

    if (deltaX > 80 && Math.abs(deltaY) < 60) {
      if (window.history.length > 1) {
        navigate(-1);
      } else if (location.pathname.startsWith('/parent/')) {
        navigate('/parent/dashboard');
      } else if (location.pathname.startsWith('/child/')) {
        navigate('/child/today');
      }
    }
  };

  return (
    <div
      data-app-frame="true"
      className="w-full max-w-md h-[100dvh] bg-gray-50 shadow-2xl overflow-hidden relative isolate flex flex-col font-sans mx-auto sm:my-4 sm:h-[780px] sm:rounded-3xl sm:border-8 sm:border-gray-800"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {children}
    </div>
  );
};

