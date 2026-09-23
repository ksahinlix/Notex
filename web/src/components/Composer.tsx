import { useMemo, useRef, useState } from 'react'
import { Clock, ImagePlus, ListChecks, Loader2, Maximize2, Minimize2, Plus, Sparkles, X } from 'lucide-react'
import { useCategorySuggestion } from '../ai/useAi'
import { formatDate } from '../lib/format'
import { imageFilesFrom } from '../lib/images'
import { blocksToText } from '../lib/paste'
import { repeatLabel } from '../lib/recurrence'
import { parseReminder } from '../lib/reminder'
import { parsePath } from '../lib/tree'
import { store } from '../state/store'
import ReminderPicker, { type ReminderChoice } from './ReminderPicker'
import RichEditor, { type RichEditorHandle } from './RichEditor'

interface Props {
  selectedPath: string[] | null
  pathOptionsId: string
}

/** Who set the path field: AI keeps filling it until the user types or picks a folder. */
type PathSource = 'ai' | 'user' | 'selection'
/** Reminder: detected from the text, set by hand, or dismissed by the user. */
type ReminderMode = 'auto' | 'manual' | 'dismissed'

// Bottom bar for writing new notes.
// - The server's AI (D15) proposes a folder, existing or new, plus similar
//   existing folders as alternatives. It is only asked while the path is left
//   to AI, so a chosen path (e.g. a locked folder) never sends the text anywhere.
// - Dates in the text ("yarın 15:00") and words like "hatırlat" become a
//   reminder automatically; the clock button sets one by hand.
// - The editor keeps pasted web content with its images, grows with the text,
//   and has a full-screen mode for long notes.
export default function Composer({ selectedPath, pathOptionsId }: Props) {
  const editor = useRef<RichEditorHandle>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [empty, setEmpty] = useState(true)
  const [imagesLoading, setImagesLoading] = useState(false)
  const [editorKey, setEditorKey] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [path, setPath] = useState('')
  const [pathSource, setPathSource] = useState<PathSource>('ai')
  const [isListItem, setIsListItem] = useState(false)
  const [reminderMode, setReminderMode] = useState<ReminderMode>('auto')
  const [manualReminder, setManualReminder] = useState<ReminderChoice>({ at: null })
  const [pickerOpen, setPickerOpen] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Picking a folder in the sidebar pre-fills the path (adjusting state during
  // render when the prop changes, as the React docs recommend over an effect).
  const [prevSelected, setPrevSelected] = useState(selectedPath)
  if (selectedPath !== prevSelected) {
    setPrevSelected(selectedPath)
    if (selectedPath) {
      setPath(selectedPath.join(' / '))
      setPathSource('selection')
    } else if (pathSource === 'selection') {
      // Back to "Tümü": the path came from the old selection, so let AI choose again.
      setPath('')
      setPathSource('ai')
    }
  }

  const category = useCategorySuggestion(text, pathSource === 'ai')
  const result = category.result
  // Chips: the AI's folder first, then similar existing folders.
  const chips = result ? [{ path: result.path, isNew: result.isNew }, ...result.alternatives.map((p) => ({ path: p, isNew: false }))] : []
  // The path shown (and saved): AI's pick while the path is AI-controlled.
  const effectivePath = pathSource === 'ai' && result ? result.path.join(' / ') : path
  // Saving waits while the AI-controlled folder is still being decided for the current text.
  const waitingForAi = pathSource === 'ai' && category.loading

  // Reminder found in the text (recomputed only when the text changes).
  const detected = useMemo(() => parseReminder(text), [text])
  // The reminder that will be saved: null = none; { at: null } = without a date.
  const reminder: ReminderChoice | null =
    reminderMode === 'manual' ? manualReminder : reminderMode === 'auto' && detected ? { at: detected.date, repeat: detected.repeat ?? null } : null
  const reminderAt = reminder?.at ? reminder.at.toISOString() : null

  function reset() {
    setEditorKey((k) => k + 1) // fresh, empty editor
    setText('')
    setEmpty(true)
    setIsListItem(false)
    setReminderMode('auto')
    setManualReminder({ at: null })
    setPickerOpen(false)
    setExpanded(false)
    if (!selectedPath) {
      setPath('')
      setPathSource('ai')
    }
  }

  async function save() {
    const blocks = editor.current?.getBlocks() ?? []
    const t = blocksToText(blocks)
    const p = parsePath(effectivePath)
    if (!t && !blocks.length) return
    if (imagesLoading) return setError('Görseller hâlâ yükleniyor, bir saniye...')
    if (waitingForAi) return
    if (!p.length) return setError('Önce bir yol yaz: Kategori / Klasör / Sayfa')
    setBusy(true)
    setError('')
    const ok = await store.create(
      p,
      {
        text: t,
        blocks,
        listItemText: isListItem ? t : null,
        reminderLabel: reminder ? t.split('\n')[0].slice(0, 80) : null,
        comments: [],
      },
      { isListItem, reminderAt, isReminder: !!reminder, repeat: reminder?.repeat ?? null },
    )
    setBusy(false)
    if (!ok) return setError('Şifre girilmeden bu klasöre kaydedilemez.')
    reset()
    setTimeout(() => editor.current?.focus())
  }

  return (
    <div className={`composer-bar ${expanded ? 'expanded' : ''}`} onKeyDown={(e) => e.key === 'Escape' && expanded && setExpanded(false)}>
      <div className="composer card">
        <RichEditor
          key={editorKey}
          ref={editor}
          className="composer-editor"
          placeholder="Aklına geleni yaz... Web sayfasından görselli içerik yapıştırabilirsin. Ctrl+Enter kaydeder."
          onChange={(t, e) => {
            setText(t)
            setEmpty(e)
            if (!t) setReminderMode((m) => (m === 'dismissed' ? 'auto' : m))
          }}
          onSubmit={() => void save()}
          onBusyChange={setImagesLoading}
        />

        {reminder && (
          <div className="reminder-chip">
            <Clock size={12} />
            <button className="link" title="Zamanı değiştir" onClick={() => setPickerOpen(true)}>
              {reminder.at && reminder.repeat ? (
                <>Hatırlatma: <b>{repeatLabel(reminder.at, reminder.repeat)}</b></>
              ) : reminder.at ? (
                <>Hatırlatma: <b>{formatDate(reminder.at.toISOString())}</b></>
              ) : (
                <>Hatırlatma: <b>tarihsiz</b></>
              )}
            </button>
            {reminderMode === 'auto' && detected && <span className="muted">(“{detected.matched}”)</span>}
            <button className="icon-btn" title="Hatırlatmayı kaldır" onClick={() => setReminderMode('dismissed')}><X size={12} /></button>
          </div>
        )}
        {pickerOpen && (
          <div className="picker-anchor">
            <ReminderPicker
              value={reminder?.at ?? null}
              repeat={reminder?.repeat ?? null}
              onPick={(choice) => {
                setManualReminder(choice)
                setReminderMode('manual')
                setPickerOpen(false)
              }}
              onClose={() => setPickerOpen(false)}
            />
          </div>
        )}

        <div className="composer-row">
          <input
            className="path-input"
            list={pathOptionsId}
            placeholder="Kategori / Klasör (boş bırakırsan AI seçer)"
            value={effectivePath}
            onChange={(e) => {
              setPath(e.target.value)
              setPathSource(e.target.value.trim() ? 'user' : 'ai')
            }}
          />
          <button className={`btn btn-ghost ${isListItem ? 'on' : ''}`} title="Liste öğesi (işaretlenebilir)" onClick={() => setIsListItem(!isListItem)}>
            <ListChecks size={14} />
          </button>
          <button
            className={`btn btn-ghost ${reminder ? 'on' : ''}`}
            title="Hatırlatma ekle"
            onClick={() => setPickerOpen((o) => !o)}
          >
            <Clock size={14} />
          </button>
          <button className="btn btn-ghost" title="Görsel ekle" onClick={() => fileRef.current?.click()}>
            <ImagePlus size={14} />
          </button>
          <button className="btn btn-ghost" title={expanded ? 'Küçült (Esc)' : 'Tam ekran yaz'} onClick={() => setExpanded(!expanded)}>
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void save()}
            disabled={busy || imagesLoading || waitingForAi || empty || !effectivePath.trim()}
            title={waitingForAi ? 'AI klasörü belirliyor...' : undefined}
          >
            {imagesLoading || waitingForAi ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} Ekle
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              editor.current?.insertFiles(imageFilesFrom(e.target.files))
              e.target.value = ''
            }}
          />
        </div>

        {(chips.length > 0 || category.loading) && (
          <div className="suggestions" data-for={category.forText} data-loading={category.loading || undefined}>
            {category.loading ? <Loader2 size={12} className="spin c-accent" /> : <Sparkles size={12} className="c-accent" />}
            {chips.map((c) => {
              const label = c.path.join(' / ')
              return (
                <button
                  key={label}
                  className={`chip ${label === effectivePath ? 'on' : ''}`}
                  title={c.isNew ? 'AI yeni bir klasör öneriyor' : 'Mevcut klasör'}
                  onClick={() => {
                    setPath(label)
                    setPathSource('user')
                  }}
                >
                  {label}
                  {c.isNew && <span className="chip-new">yeni</span>}
                </button>
              )
            })}
            {category.loading && !chips.length && <span className="muted small">AI kategori düşünüyor...</span>}
          </div>
        )}
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  )
}
