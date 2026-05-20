import React from 'react';
import { Megaphone } from 'lucide-react';

/**
 * AnnouncementBanner — fetches the active platform banner from the public
 * /api/announcement endpoint.
 *
 * variant="header"  → compact inline chip shown inside the app header.
 *                     Renders nothing when no banner is active, so the
 *                     header layout is unaffected.
 *
 * Clicking the banner toggles between truncated and expanded text.
 * Hovering shows the full text via the native title tooltip.
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
  const [expanded, setExpanded] = React.useState(false);

  if (!active || !text) return null;

  return (
    <button
      type="button"
      role="status"
      aria-live="polite"
      title={text}
      onClick={() => setExpanded((v) => !v)}
      dir="auto"
      className={`flex min-w-0 items-start gap-1.5 border border-amber-200 bg-amber-50 px-3 py-1 transition-all hover:bg-amber-100 ${
        expanded ? 'max-w-md rounded-lg' : 'max-w-sm cursor-pointer rounded-full'
      }`}
    >
      <Megaphone className="h-3.5 w-3.5 shrink-0 text-amber-600 mt-0.5" aria-hidden="true" />
      <span className={`text-xs font-medium text-amber-800 ${expanded ? 'whitespace-normal break-words' : 'truncate'}`}>
        {text}
      </span>
    </button>
  );
}
