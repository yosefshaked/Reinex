/* eslint-env node */

export default async function (context) {
  const timestamp = new Date().toISOString();

  context.res = {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-read=(), clipboard-write=(self)',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    },
    body: JSON.stringify({
      ok: true,
      timestamp,
    }),
  };
}
