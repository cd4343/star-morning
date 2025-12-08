import React, { ReactNode } from 'react';

export const Layout = ({ children }: { children: ReactNode }) => (
  <div className="w-full max-w-md h-[100dvh] bg-gray-50 shadow-2xl overflow-hidden relative isolate flex flex-col font-sans mx-auto sm:my-4 sm:h-[780px] sm:rounded-3xl sm:border-8 sm:border-gray-800">
    {children}
  </div>
);

