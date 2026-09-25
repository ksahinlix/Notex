import { initials, personColor, personName, sharePeople } from '../lib/sharing'
import type { Note, Person } from '../lib/types'
import { useNotex } from '../state/store'
import { showToast } from '../state/toast'

const SHOW = 3

/** One face: the Google photo when there is one, otherwise the initials. */
function Face({ person }: { person: Person }) {
  const key = person.id ?? person.email
  const hue = personColor(key)
  return person.picture ? (
    <img className="face" src={person.picture} alt="" referrerPolicy="no-referrer" title={personName(person)} />
  ) : (
    // Only the hue is set here; how light it is belongs to the theme (index.css).
    <span className="face" title={personName(person)} style={{ '--face-h': hue } as React.CSSProperties}>
      {initials(person)}
    </span>
  )
}

/**
 * Who else sees this note, as faces rather than an icon: the owner of a
 * folder shared with you, or the people you shared it with. The name is
 * spelled out in our own tooltip, which appears at once — the browser's
 * `title` waits about a second and never shows up on a phone.
 */
export default function SharedMark({ note }: { note: Note }) {
  const state = useNotex()
  const info = sharePeople(note, state.shares, state.sharedWithMe, state.userId)
  if (!info) return null
  const shown = info.people.slice(0, SHOW)
  const rest = info.people.length - shown.length
  return (
    <span
      className={`shared-mark ${info.theirs ? 'theirs' : ''}`}
      tabIndex={0}
      aria-label={info.label}
      // A phone has no hover, so a tap says it in the usual message strip.
      onClick={() => matchMedia('(hover: none)').matches && showToast({ message: info.label })}
    >
      {shown.map((p) => (
        <Face key={p.id ?? p.email} person={p} />
      ))}
      {rest > 0 && <span className="face more">+{rest}</span>}
      <span className="tip" role="tooltip">{info.label}</span>
    </span>
  )
}
