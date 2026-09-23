import { useEffect, useLayoutEffect, useState } from 'react'
import { X } from 'lucide-react'
import { availableSteps, TOUR_STEPS, type TourStep } from '../lib/tour'

const PAD = 6 // space around the highlighted element
const CARD_W = 340

const find = (target: string) => document.querySelector<HTMLElement>(`[data-tour="${target}"]`)
const visible = (el: HTMLElement | null) => !!el && el.getClientRects().length > 0
const onScreen = (s: TourStep) => !s.target || visible(find(s.target))

/** Next (dir 1) or previous (dir -1) step whose element is on screen, or -1. */
function stepFrom(i: number, dir: 1 | -1): number {
  for (let j = i + dir; j >= 0 && j < TOUR_STEPS.length; j += dir) if (onScreen(TOUR_STEPS[j])) return j
  return -1
}

// Guided tour: dims the page, highlights one element at a time (data-tour=…)
// and explains it. ← → / Enter move, Esc closes. On phones the explanation
// sits at the bottom of the screen.
export default function Tour({ onClose }: { onClose: () => void }) {
  // Targets are checked when moving to a step (not once at the start): on the
  // first visit the tour opens in the same render as the note list.
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const step = TOUR_STEPS[i]
  const last = stepFrom(i, 1) === -1
  const next = () => {
    const j = stepFrom(i, 1)
    if (j === -1) onClose()
    else setI(j)
  }
  const back = () => {
    const j = stepFrom(i, -1)
    if (j !== -1) setI(j)
  }
  const dots = availableSteps(TOUR_STEPS, (t) => visible(find(t)))

  // Follow the target: scroll it into view, and track it on resize/scroll.
  useLayoutEffect(() => {
    const el = step?.target ? find(step.target) : null
    el?.classList.add('tour-focus') // e.g. shows a note's hover-only buttons
    el?.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
    const update = () => setRect(el ? el.getBoundingClientRect() : null)
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      el?.classList.remove('tour-focus')
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [step])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault() // Enter must not also click the focused button
        next()
      } else if (e.key === 'ArrowLeft') back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!step) return null

  // Card position: below the target if there is room, otherwise above; centered when there's no target.
  const vw = window.innerWidth
  const vh = window.innerHeight
  const phone = vw < 600
  let cardStyle: React.CSSProperties
  if (!rect) {
    cardStyle = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: Math.min(CARD_W + 60, vw - 24) }
  } else if (phone) {
    // a sheet on the side away from the target, so it never covers it
    const targetLow = rect.top + rect.height / 2 > vh / 2
    cardStyle = targetLow ? { left: 12, right: 12, top: 12 } : { left: 12, right: 12, bottom: 12 }
  } else {
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - CARD_W / 2), vw - CARD_W - 12)
    const below = rect.bottom + PAD + 12
    cardStyle = vh - below > 190 ? { left, top: below, width: CARD_W } : { left, bottom: vh - rect.top + PAD + 12, width: CARD_W }
  }

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="Kullanım turu">
      {rect ? (
        <div
          className="tour-spot"
          style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
        />
      ) : (
        <div className="tour-dim" />
      )}
      <div className={`tour-card card ${phone && rect ? 'sheet' : ''}`} style={cardStyle}>
        <button className="icon-btn tour-x" aria-label="Turu kapat" onClick={onClose}><X size={14} /></button>
        <div className="tour-title">{step.title}</div>
        <div className="tour-body">{step.body}</div>
        <div className="tour-foot">
          <span className="tour-dots" aria-label={`${dots.indexOf(step) + 1} / ${dots.length}`}>
            {dots.map((d) => <span key={d.title} className={d === step ? 'on' : ''} />)}
          </span>
          {i > 0 && <button className="btn btn-ghost" onClick={back}>Geri</button>}
          <button className="btn btn-primary" autoFocus onClick={next}>
            {last ? 'Bitir' : i === 0 ? 'Başlayalım' : 'İleri'}
          </button>
        </div>
      </div>
    </div>
  )
}
