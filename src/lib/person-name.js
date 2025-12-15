export function buildDisplayName(
  {
    firstName,
    middleName,
    lastName,
    first_name,
    middle_name,
    last_name,
    fallback,
  } = {}
) {
  const parts = [
    firstName ?? first_name,
    middleName ?? middle_name,
    lastName ?? last_name,
  ]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean);

  if (parts.length > 0) {
    return parts.join(' ');
  }

  if (typeof fallback === 'string' && fallback.trim()) {
    return fallback.trim();
  }

  return '';
}
