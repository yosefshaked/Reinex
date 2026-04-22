import React from 'react';
import { X, Megaphone } from 'lucide-react';

/**
 * AnnouncementBanner — fetches the active platform banner from the public
 * /api/announcement endpoint and renders it below the app shell header.
 *
 * Dismissed banners are remembered in sessionStorage so they don't re-appear
 * on every page navigation within the same browser tab.
 */

function useBanner() {
  const [state, setState] = React.useState({ active: false, text: '', loaded: false });

  React.useEffect(() => {
    let cancelled = false;

    fetch('/api/announcement')
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (cancelled) return;
        setState({
          active: Boolean(data?.active),
          text: typeof data?.text === 'string' ? data.text : '',
          loaded: true,
        });
      })
      .catch(() => {
        if (!cancelled) setState((prev) => ({ ...prev, loaded: true }));
      });

    return () => { cancelled = true; };
  }, []);

  return state;
}

function getDismissKey(text) {
  return `banner:dismissed:${text.slice(0, 80)}`;
}

export default function AnnouncementBanner() {
  const { active, text, loaded } = useBanner();
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    if (!loaded || !active || !text) return;
    try {
      if (sessionStorage.getItem(getDismissKey(text)) === '1') {
        setDismissed(true);
      } else {
        setDismissed(false);
      }
    } catch {
      // sessionStorage unavailable
    }
  }, [active, text, loaded]);

  if (!active || !text || dismissed) return null;

  const handleDismiss = () => {
    try { sessionStorage.setItem(getDismissKey(text), '1'); } catch { /* ignore */ }
    setDismissed(true);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900"
    >
      <Megaphone className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
      <p className="flex-1 leading-5">{text}</p>
      <button
        type="button"
        onClick={handleDismiss}
        className="rounded p-1 hover:bg-amber-100"
        aria-label="Dismiss announcement"
      >
        <X className="h-3.5 w-3.5 text-amber-700" />
      </button>
    </div>
  );
}
