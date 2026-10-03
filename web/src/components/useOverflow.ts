import { useEffect, useState, type RefObject } from 'react'

/**
 * True while an element is taller than the room it has been given — i.e. its
 * content is being clipped, so "Devamını oku" is worth offering (D25).
 *
 * Measured rather than guessed from the text length: wrapping depends on the
 * window width, the font and any images, so counting characters gets it wrong
 * on exactly the notes where it matters.
 */
export function useOverflow(ref: RefObject<HTMLElement | null>, enabled: boolean, key?: unknown): boolean {
  const [over, setOver] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return setOver(false)
    const check = () => setOver(el.scrollHeight > el.clientHeight + 1)
    check()
    // The window getting narrower makes the same text taller.
    const ro = new ResizeObserver(check)
    ro.observe(el)
    // An image that finishes loading changes the height without resizing the
    // clipped box, so ResizeObserver never hears about it. `load` does not
    // bubble, hence the capture phase.
    el.addEventListener('load', check, true)
    return () => {
      ro.disconnect()
      el.removeEventListener('load', check, true)
    }
  }, [ref, enabled, key])

  return over
}
