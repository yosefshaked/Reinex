import { useEffect, useState } from 'react'

// Returns the number of pixels the on-screen keyboard overlaps the visual viewport bottom.
// Uses the VisualViewport API when available; otherwise returns 0.
export default function useKeyboardAwareBottomOffset() {
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    const vv = typeof window !== 'undefined' && window.visualViewport
    if (!vv) {
      setOffset(0)
      return
    }

    const compute = () => {
      try {
        // keyboard height approx = layout viewport height - visual viewport height - offsetTop
        const layoutH = window.innerHeight || 0
        const visualH = vv.height || 0
        const top = vv.offsetTop || 0
        const keyboard = Math.max(0, Math.round(layoutH - visualH - top))
        setOffset(keyboard)
      } catch {
        setOffset(0)
      }
    }

    compute()
    vv.addEventListener('resize', compute)
    vv.addEventListener('scroll', compute)

    return () => {
      vv.removeEventListener('resize', compute)
      vv.removeEventListener('scroll', compute)
    }
  }, [])

  return offset
}
