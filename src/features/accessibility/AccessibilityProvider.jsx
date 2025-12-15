import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const A11yContext = createContext(null)

const STORAGE_KEYS = {
  fontScale: 'a11y:fontScale',
  highContrast: 'a11y:highContrast',
  textSpacing: 'a11y:textSpacing',
  underlineLinks: 'a11y:underlineLinks',
  dyslexiaFont: 'a11y:dyslexiaFont',
  highlightInteractives: 'a11y:highlightInteractives',
  noAnimations: 'a11y:noAnimations',
  structureOverlay: 'a11y:structureOverlay',
  grayscale: 'a11y:grayscale',
}

const A11Y_STYLE_ID = 'a11y-dynamic-styles'
const A11Y_CSS = `
/* Accessibility helpers: no @layer here since this is injected at runtime */

/* Text spacing increases letter/word spacing and line-height across body text. */
.a11y-text-spacing body,
.a11y-text-spacing .prose,
.a11y-text-spacing *:where(p,li,span,a,button,label,small,strong,em) {
  letter-spacing: 0.12em;
  word-spacing: 0.16em;
  line-height: 1.75;
}

/* Underline links for clearer affordance */
.a11y-underline-links a[href] {
  text-decoration: underline;
  text-underline-offset: 0.15em;
  text-decoration-thickness: 2px;
}

/* Dyslexia-friendly font family */
.a11y-dyslexia-font,
.a11y-dyslexia-font * {
  font-family: 'Atkinson Hyperlegible', 'Comic Sans MS', 'Arial', system-ui, sans-serif !important;
  letter-spacing: 0.02em !important;
  word-spacing: 0.1em !important;
}

/* Highlight interactive elements (buttons, links, controls) */
.a11y-highlight-interactives :is(a[href], button, [role="button"], input, select, textarea, [tabindex]:not([tabindex="-1"])) {
  outline: 2px solid rgb(59 130 246 / 0.9);
  outline-offset: 2px;
  box-shadow: 0 0 0 2px rgba(255,255,255,0.8), 0 0 0 4px rgba(59,130,246,0.6);
}

/* Stop animations and transitions globally */
.a11y-no-animations *, .a11y-no-animations *::before, .a11y-no-animations *::after {
  animation: none !important;
  transition: none !important;
  scroll-behavior: auto !important;
}

/* Page structure overlay: outline landmarks and headings */
.a11y-structure :is(main, nav, aside, header, footer, section, article, h1, h2, h3, h4, h5, h6) {
  outline: 2px dashed rgba(16,185,129,0.9);
  outline-offset: 2px;
}

/* Grayscale mode */
.a11y-grayscale {
  filter: grayscale(1);
}
`

function ensureA11yStylesInjected() {
  if (typeof document === 'undefined') return
  if (document.getElementById(A11Y_STYLE_ID)) return
  try {
    const style = document.createElement('style')
    style.id = A11Y_STYLE_ID
    style.textContent = A11Y_CSS
    document.head.appendChild(style)
  } catch (err) {
    console.warn('[a11y] Failed to inject dynamic styles', err)
  }
}

function applyFontScale(scale) {
  const clamped = Math.min(1.4, Math.max(0.9, Number(scale) || 1))
  document.documentElement.style.setProperty('--a11y-font-scale', String(clamped))
}

function applyHighContrast(enabled) {
  const root = document.documentElement
  if (enabled) root.classList.add('a11y-hc')
  else root.classList.remove('a11y-hc')
}

function applyTextSpacing(enabled) {
  const root = document.documentElement
  root.classList.toggle('a11y-text-spacing', Boolean(enabled))
}

function applyUnderlineLinks(enabled) {
  const root = document.documentElement
  root.classList.toggle('a11y-underline-links', Boolean(enabled))
}

function applyDyslexiaFont(enabled) {
  const root = document.documentElement
  root.classList.toggle('a11y-dyslexia-font', Boolean(enabled))
}

export function AccessibilityProvider({ children }) {
  const [fontScale, setFontScaleState] = useState(1)
  const [highContrast, setHighContrastState] = useState(false)
  const [textSpacing, setTextSpacingState] = useState(false)
  const [underlineLinks, setUnderlineLinksState] = useState(false)
  const [dyslexiaFont, setDyslexiaFontState] = useState(false)
  const [highlightInteractives, setHighlightInteractives] = useState(false)
  const [noAnimations, setNoAnimations] = useState(false)
  const [structureOverlay, setStructureOverlay] = useState(false)
  const [grayscale, setGrayscale] = useState(false)

  // Inject dynamic styles once
  useEffect(() => { ensureA11yStylesInjected() }, [])

  // Load settings once
  useEffect(() => {
    try {
      const storedScale = parseFloat(localStorage.getItem(STORAGE_KEYS.fontScale) || '1')
      const storedHc = localStorage.getItem(STORAGE_KEYS.highContrast) === '1'
  const storedTs = localStorage.getItem(STORAGE_KEYS.textSpacing) === '1'
  const storedUl = localStorage.getItem(STORAGE_KEYS.underlineLinks) === '1'
  const storedDf = localStorage.getItem(STORAGE_KEYS.dyslexiaFont) === '1'
  const storedHi = localStorage.getItem(STORAGE_KEYS.highlightInteractives) === '1'
  const storedNa = localStorage.getItem(STORAGE_KEYS.noAnimations) === '1'
  const storedSo = localStorage.getItem(STORAGE_KEYS.structureOverlay) === '1'
  const storedGs = localStorage.getItem(STORAGE_KEYS.grayscale) === '1'

      setFontScaleState(Number.isFinite(storedScale) ? storedScale : 1)
      setHighContrastState(Boolean(storedHc))
      setTextSpacingState(Boolean(storedTs))
      setUnderlineLinksState(Boolean(storedUl))
  setDyslexiaFontState(Boolean(storedDf))
  setHighlightInteractives(Boolean(storedHi))
  setNoAnimations(Boolean(storedNa))
  setStructureOverlay(Boolean(storedSo))
  setGrayscale(Boolean(storedGs))

      applyFontScale(storedScale)
      applyHighContrast(storedHc)
      applyTextSpacing(storedTs)
      applyUnderlineLinks(storedUl)
      applyDyslexiaFont(storedDf)
  document.documentElement.classList.toggle('a11y-highlight-interactives', storedHi)
  document.documentElement.classList.toggle('a11y-no-animations', storedNa)
  document.documentElement.classList.toggle('a11y-structure', storedSo)
  document.documentElement.classList.toggle('a11y-grayscale', storedGs)
    } catch (err) {
      // noop: fallback to defaults when storage is unavailable
      console.warn('[a11y] Failed to load preferences', err)
      applyFontScale(1)
      applyHighContrast(false)
      applyTextSpacing(false)
      applyUnderlineLinks(false)
      applyDyslexiaFont(false)
      document.documentElement.classList.remove('a11y-highlight-interactives','a11y-no-animations','a11y-structure','a11y-grayscale')
    }
  }, [])

  const setFontScale = useCallback((next) => {
    const value = Math.min(1.4, Math.max(0.9, Number(next) || 1))
    setFontScaleState(value)
    try { localStorage.setItem(STORAGE_KEYS.fontScale, String(value)) } catch (err) { console.warn('[a11y] Failed to save font scale', err) }
    applyFontScale(value)
  }, [])

  const increaseFont = useCallback(() => setFontScale((fontScale || 1) + 0.1), [setFontScale, fontScale])
  const decreaseFont = useCallback(() => setFontScale((fontScale || 1) - 0.1), [setFontScale, fontScale])

  const toggleHighContrast = useCallback(() => {
    setHighContrastState((prev) => {
      const next = !prev
      try { localStorage.setItem(STORAGE_KEYS.highContrast, next ? '1' : '0') } catch (err) { console.warn('[a11y] Failed to save contrast preference', err) }
      applyHighContrast(next)
      return next
    })
  }, [])

  const toggleTextSpacing = useCallback(() => {
    setTextSpacingState((prev) => {
      const next = !prev
      try { localStorage.setItem(STORAGE_KEYS.textSpacing, next ? '1' : '0') } catch (err) { console.warn('[a11y] Failed to save text spacing', err) }
      applyTextSpacing(next)
      return next
    })
  }, [])

  const toggleUnderlineLinks = useCallback(() => {
    setUnderlineLinksState((prev) => {
      const next = !prev
      try { localStorage.setItem(STORAGE_KEYS.underlineLinks, next ? '1' : '0') } catch (err) { console.warn('[a11y] Failed to save underline links', err) }
      applyUnderlineLinks(next)
      return next
    })
  }, [])

  const toggleDyslexiaFont = useCallback(() => {
    setDyslexiaFontState((prev) => {
      const next = !prev
      try { localStorage.setItem(STORAGE_KEYS.dyslexiaFont, next ? '1' : '0') } catch (err) { console.warn('[a11y] Failed to save dyslexia font', err) }
      applyDyslexiaFont(next)
      return next
    })
  }, [])

  const toggleHighlightInteractives = useCallback(() => {
    setHighlightInteractives((prev) => {
      const next = !prev
      try { localStorage.setItem(STORAGE_KEYS.highlightInteractives, next ? '1' : '0') } catch (err) { console.warn('[a11y] Failed to save highlight preference', err) }
      document.documentElement.classList.toggle('a11y-highlight-interactives', next)
      return next
    })
  }, [])

  const toggleNoAnimations = useCallback(() => {
    setNoAnimations((prev) => {
      const next = !prev
      try { localStorage.setItem(STORAGE_KEYS.noAnimations, next ? '1' : '0') } catch (err) { console.warn('[a11y] Failed to save animation preference', err) }
      document.documentElement.classList.toggle('a11y-no-animations', next)
      return next
    })
  }, [])

  const toggleStructureOverlay = useCallback(() => {
    setStructureOverlay((prev) => {
      const next = !prev
      try { localStorage.setItem(STORAGE_KEYS.structureOverlay, next ? '1' : '0') } catch (err) { console.warn('[a11y] Failed to save structure overlay', err) }
      document.documentElement.classList.toggle('a11y-structure', next)
      return next
    })
  }, [])

  const toggleGrayscale = useCallback(() => {
    setGrayscale((prev) => {
      const next = !prev
      try { localStorage.setItem(STORAGE_KEYS.grayscale, next ? '1' : '0') } catch (err) { console.warn('[a11y] Failed to save grayscale preference', err) }
      document.documentElement.classList.toggle('a11y-grayscale', next)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    setFontScale(1)
    setHighContrastState(false)
    setTextSpacingState(false)
    setUnderlineLinksState(false)
    setDyslexiaFontState(false)
    setHighlightInteractives(false)
    setNoAnimations(false)
    setStructureOverlay(false)
    setGrayscale(false)
    try {
      localStorage.removeItem(STORAGE_KEYS.fontScale)
      localStorage.removeItem(STORAGE_KEYS.highContrast)
      localStorage.removeItem(STORAGE_KEYS.textSpacing)
      localStorage.removeItem(STORAGE_KEYS.underlineLinks)
      localStorage.removeItem(STORAGE_KEYS.dyslexiaFont)
      localStorage.removeItem(STORAGE_KEYS.highlightInteractives)
      localStorage.removeItem(STORAGE_KEYS.noAnimations)
      localStorage.removeItem(STORAGE_KEYS.structureOverlay)
      localStorage.removeItem(STORAGE_KEYS.grayscale)
    } catch (err) {
      console.warn('[a11y] Failed to clear preferences', err)
    }
    applyHighContrast(false)
    applyTextSpacing(false)
    applyUnderlineLinks(false)
    applyDyslexiaFont(false)
    document.documentElement.classList.remove('a11y-highlight-interactives','a11y-no-animations','a11y-structure','a11y-grayscale')
  }, [setFontScale])

  const value = useMemo(() => ({
    fontScale,
    setFontScale,
    increaseFont,
    decreaseFont,

    highContrast,
    toggleHighContrast,

    textSpacing,
    toggleTextSpacing,

    underlineLinks,
    toggleUnderlineLinks,

    dyslexiaFont,
    toggleDyslexiaFont,

    highlightInteractives,
    toggleHighlightInteractives,

    noAnimations,
    toggleNoAnimations,

    structureOverlay,
    toggleStructureOverlay,

    grayscale,
    toggleGrayscale,

    reset,
  }), [fontScale, setFontScale, increaseFont, decreaseFont, highContrast, toggleHighContrast, textSpacing, toggleTextSpacing, underlineLinks, toggleUnderlineLinks, dyslexiaFont, toggleDyslexiaFont, highlightInteractives, toggleHighlightInteractives, noAnimations, toggleNoAnimations, structureOverlay, toggleStructureOverlay, grayscale, toggleGrayscale, reset])

  return (
    <A11yContext.Provider value={value}>
      {children}
    </A11yContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAccessibility() {
  const ctx = useContext(A11yContext)
  if (!ctx) throw new Error('useAccessibility must be used within AccessibilityProvider')
  return ctx
}
