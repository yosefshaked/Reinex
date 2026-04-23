import React from 'react';
import { Megaphone } from 'lucide-react';

/**
 * AnnouncementBanner — fetches the active platform banner from the public
 * /api/announcement endpoint.
 *
 * variant="header"  → compact inline chip shown inside the app header.
 *                     Renders nothing when no banner is active, so the
 *                     header layout is unaffected.
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

export default function AnnouncementBanner() {
  const { active, text } = useBanner();

  if (!active || !text) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-w-0 max-w-sm items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1"
    >
      <Megaphone className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
      <span className="truncate text-xs font-medium text-amber-800">{text}</span>
    </div>
  );
}
