export function normalizeExternalHttpUrl(value) {
  const trimmedValue = typeof value === 'string' ? value.trim() : '';
  if (!trimmedValue) {
    return '';
  }

  const candidate = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmedValue)
    ? trimmedValue
    : `https://${trimmedValue}`;

  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}
