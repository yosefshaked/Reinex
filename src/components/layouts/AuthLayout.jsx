import React from 'react';
import { Link } from 'react-router-dom';
import Logo from '@/components/branding/Logo.jsx';
import { cn } from '@/lib/utils';

export default function AuthLayout({ children, cardClassName = '', contentClassName = '' }) {
  return (
    <div className="relative min-h-screen bg-gradient-to-br from-slate-100 via-blue-50 to-slate-200" dir="rtl">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(79,70,229,0.12),_transparent_55%)]"
        aria-hidden="true"
      />
      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="flex justify-center px-4 py-8">
          <Link
            to="/"
            className="inline-flex items-center gap-3 rounded-2xl bg-white/70 px-5 py-2 shadow transition hover:bg-white"
            aria-label="חזרה לדף הבית"
          >
            <Logo />
          </Link>
        </header>
        <main className="flex flex-1 items-center justify-center px-4 pb-12">
          <div className={cn('w-full max-w-lg', cardClassName)}>
            <div
              className={cn(
                'flex flex-col overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-xl backdrop-blur-sm',
                contentClassName,
              )}
            >
              {children}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
