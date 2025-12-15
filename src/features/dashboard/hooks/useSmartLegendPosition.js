import { useEffect, useRef, useState } from 'react'

const GUTTER_PX = 24
const VIEWPORT_MARGIN_PX = 16
const DEFAULT_HEADER_HEIGHT_PX = 72
const HEADER_MARGIN_PX = 16
const BASE_STYLE = {
  position: 'fixed',
  opacity: 0,
  pointerEvents: 'none',
  visibility: 'hidden',
  zIndex: 30,
}

function resolveHeaderOffset() {
  if (typeof window === 'undefined') {
    return DEFAULT_HEADER_HEIGHT_PX + HEADER_MARGIN_PX
  }

  try {
    const root = document.documentElement
    if (!root) {
      return DEFAULT_HEADER_HEIGHT_PX + HEADER_MARGIN_PX
    }

    const computed = window.getComputedStyle(root)
    const rawHeight = computed.getPropertyValue('--app-shell-header-height')
    const parsedHeight = parseFloat(rawHeight)

    const headerHeight = Number.isFinite(parsedHeight) ? parsedHeight : DEFAULT_HEADER_HEIGHT_PX
    return headerHeight + HEADER_MARGIN_PX
  } catch (error) {
    console.warn('Failed to resolve header offset for legend positioning', error)
    return DEFAULT_HEADER_HEIGHT_PX + HEADER_MARGIN_PX
  }
}

export function useSmartLegendPosition({ calendarRef, legendRef, isEnabled }) {
  const [style, setStyle] = useState(() => BASE_STYLE)
  const frameRef = useRef(null)
  const legendWidthRef = useRef(0)

  useEffect(() => {
    if (!isEnabled) {
      setStyle(BASE_STYLE)
      return undefined
    }

    const updatePosition = () => {
      frameRef.current = null

      const calendarEl = calendarRef?.current
      const legendEl = legendRef?.current

      if (!calendarEl || !legendEl) {
        setStyle(BASE_STYLE)
        return
      }

      const calendarRect = calendarEl.getBoundingClientRect()
      const rawLegendWidth = legendEl.offsetWidth
      if (rawLegendWidth > 0) {
        legendWidthRef.current = rawLegendWidth
      }

      const legendWidth = legendWidthRef.current
      if (legendWidth <= 0) {
        setStyle(BASE_STYLE)
        return
      }

      const availableLeft = calendarRect.left - VIEWPORT_MARGIN_PX
      const requiredSpace = legendWidth + GUTTER_PX

      if (availableLeft <= requiredSpace) {
        setStyle({
          ...BASE_STYLE,
          width: legendWidth,
          top: resolveHeaderOffset(),
          left: VIEWPORT_MARGIN_PX,
        })
        return
      }

      const left = Math.max(
        VIEWPORT_MARGIN_PX,
        calendarRect.left - legendWidth - GUTTER_PX,
      )
      const top = Math.max(calendarRect.top, resolveHeaderOffset())

      setStyle({
        position: 'fixed',
        top,
        left,
        opacity: 1,
        pointerEvents: 'auto',
        visibility: 'visible',
        width: legendWidth,
        zIndex: 30,
      })
    }

    const scheduleUpdate = () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current)
      }
      frameRef.current = requestAnimationFrame(updatePosition)
    }

    scheduleUpdate()

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => scheduleUpdate())
      : null

    const calendarEl = calendarRef?.current
    const legendEl = legendRef?.current

    if (resizeObserver) {
      if (calendarEl) {
        resizeObserver.observe(calendarEl)
      }
      if (legendEl) {
        resizeObserver.observe(legendEl)
      }
    }

    const handleScroll = () => scheduleUpdate()
    const handleResize = () => scheduleUpdate()

    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleResize)

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }

      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleResize)

      if (resizeObserver) {
        resizeObserver.disconnect()
      }
    }
  }, [calendarRef, isEnabled, legendRef])

  return style
}
