function withStripeOverlay(base, inactive, stripeOpacity = 0.32, stripeSize = 6) {
  if (!inactive) {
    return base
  }
  const overlay = `repeating-linear-gradient(45deg, rgba(255,255,255,${stripeOpacity}) 0, rgba(255,255,255,${stripeOpacity}) ${stripeSize}px, transparent ${stripeSize}px, transparent ${stripeSize * 2}px)`
  if (base.backgroundImage) {
    return {
      ...base,
      backgroundImage: `${base.backgroundImage}, ${overlay}`,
    }
  }
  if (base.backgroundColor) {
    const { backgroundColor, ...rest } = base
    return {
      ...rest,
      backgroundImage: `linear-gradient(${backgroundColor}, ${backgroundColor}), ${overlay}`,
    }
  }
  return base
}

export function normalizeColorIdentifier(identifier) {
  if (!identifier || typeof identifier !== 'string') {
    return []
  }
  return identifier
    .split(',')
    .map(token => token.trim())
    .filter(Boolean)
}

export function buildChipStyle(identifier, { inactive = false } = {}) {
  const colors = normalizeColorIdentifier(identifier)
  if (colors.length === 0) {
    return { backgroundColor: '#6B7280', color: 'white' }
  }
  if (colors.length === 1) {
    const base = { backgroundColor: colors[0], color: 'white' }
    return withStripeOverlay(base, inactive, 0.28, 8)
  }
  const gradient = `linear-gradient(135deg, ${colors.join(', ')})`
  const base = { backgroundImage: gradient, color: 'white' }
  return withStripeOverlay(base, inactive, 0.28, 8)
}

export function buildLegendStyle(identifier, { inactive = false } = {}) {
  const colors = normalizeColorIdentifier(identifier)
  if (colors.length === 0) {
    return { backgroundColor: '#6B7280' }
  }
  if (colors.length === 1) {
    const base = { backgroundColor: colors[0] }
    return withStripeOverlay(base, inactive)
  }
  const gradient = `linear-gradient(135deg, ${colors.join(', ')})`
  const base = { backgroundImage: gradient }
  return withStripeOverlay(base, inactive)
}
