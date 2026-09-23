import { useEffect, useMemo, useState } from 'react'
import { AlarmClock, CircleHelp, Loader2, LogOut, NotebookPen, Search, Sparkles, X } from 'lucide-react'
import { clearSearchCache, useSemanticSearch } from '../ai/useAi'
import { isReminderNote } from '../lib/agenda'
import { queryTerms } from '../lib/highlight'
import { markTourDone, tourDone } from '../lib/tour'
import { folderInto, folderRenamed, noteMoveTarget } from '../lib/move'
import { matchesQuery } from '../lib/notes'
import { allPaths, buildTree, findProtectedAncestor, pathKeyOf, pathStartsWith } from '../lib/tree'
import type { User } from '../lib/api'
import type { Note } from '../lib/types'
import { store, useNotex } from '../state/store'
import { showToast } from '../state/toast'
import Composer from './Composer'
import { ConfirmHost } from './ConfirmDialog'
import Lightbox from './Lightbox'
import NoteCard from './NoteCard'
import PasswordModal from './PasswordModal'
import Reader from './Reader'
import RemindersPage from './RemindersPage'
import UpcomingStrip from './UpcomingStrip'
import Sidebar from './Sidebar'
import { ToastHost } from './ToastHost'
import ThemeToggle from './ThemeToggle'
import Tour from './Tour'

const PATH_OPTIONS_ID = 'notex-paths'

type View = 'notes' | 'reminders'
const viewFromHash = (): View => (location.hash === '#hatirlatmalar' ? 'reminders' : 'notes')

export default function NotesPage({ user, onLogout }: { user: User; onLogout: () => void }) {
  const state = useNotex()
  const [selectedPath, setSelectedPath] = useState<string[] | null>(null)
  const [query, setQuery] = useState('')
  // Reader: the open note and the list ← → moves through.
  const [reader, setReader] = useState<{ id: string; list: string[] } | null>(null)
  const [view, setViewState] = useState<View>(viewFromHash)
  const setView = (v: View) => {
    setViewState(v)
    history.replaceState(null, '', v === 'reminders' ? '#hatirlatmalar' : location.pathname)
  }
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [treeError, setTreeError] = useState('')
  // Guided tour: opens by itself on a user's first visit (per browser), or from the ? button.
  const [tourSeen, setTourSeen] = useState(() => tourDone(user.id))
  const [tourOpen, setTourOpen] = useState(false)
  const touring = tourOpen || (!tourSeen && state.loaded && view === 'notes')
  const closeTour = () => {
    markTourDone(user.id)
    setTourSeen(true)
    setTourOpen(false)
  }

  useEffect(() => {
    void store.load()
  }, [])

  // Reminders live on their own page, not in the notes tree or list.
  const plainNotes = useMemo(() => state.notes.filter((n) => !isReminderNote(n)), [state.notes])
  const reminderCount = state.notes.length - plainNotes.length
  const tree = useMemo(() => buildTree(plainNotes), [plainNotes])
  const paths = useMemo(() => allPaths(tree).map((p) => p.join(' / ')), [tree])
  const contentOf = (n: Note) => store.contentOf(n)

  // Notes changed: earlier AI search answers may be outdated.
  useEffect(clearSearchCache, [state.notes])

  const scoped = useMemo(
    () => (selectedPath ? plainNotes.filter((n) => pathStartsWith(n.path, selectedPath)) : plainNotes),
    [plainNotes, selectedPath],
  )
  // Search covers ALL notes (not just the selected folder): notes containing
  // the words first, then notes the AI found by meaning (D15). Locked notes
  // can't be searched.
  const searching = query.trim().length > 0
  const semantic = useSemanticSearch(query)
  const terms = useMemo(() => queryTerms(query), [query])
  const keywordHits = searching
    ? state.notes.filter((n) => {
        const c = contentOf(n)
        return !!c && matchesQuery(n, c, query)
      })
    : []
  const byId = new Map(state.notes.map((n) => [n.id, n]))
  const keywordIds = new Set(keywordHits.map((n) => n.id))
  const meaningHits = (semantic.ids ?? []).flatMap((id) => (keywordIds.has(id) ? [] : (byId.get(id) ?? [])))
  const meaningIds = new Set(meaningHits.map((n) => n.id))
  const visible = !searching ? scoped : [...keywordHits, ...meaningHits]
  const readerIndex = reader ? reader.list.indexOf(reader.id) : -1
  const readerNote = reader ? (byId.get(reader.id) ?? null) : null
  const readerContent = readerNote ? contentOf(readerNote) : undefined
  const openReader = (id: string, list: string[]) => setReader({ id, list })

  async function onLockClick(path: string[]) {
    setTreeError('')
    const pk = pathKeyOf(path)
    if (!state.folders.some((f) => f.pathKey === pk)) {
      const err = await store.protect(path)
      if (err) setTreeError(err)
    } else if (state.keys[pk]) {
      store.lock(pk)
    } else if (await store.unlock(pk)) {
      setSelectedPath(path)
    }
  }

  const noteById = (id: string) => store.getSnapshot().notes.find((n) => n.id === id)
  const show = (p: string[]) => p.join(' / ')

  /** Moves a note (rule 1 unless the path was typed) and offers the alternative and undo. */
  async function moveNote(note: Note, target: string[], exact: boolean) {
    const from = note.path
    const to = exact ? target : noteMoveTarget(note.path, target)
    if (!(await store.move(note, to))) return
    const actions = []
    if (!exact && pathKeyOf(to) !== pathKeyOf(target)) {
      actions.push({ label: `Sadece ${show(target)} içine koy`, run: () => void moveBack(note.id, target) })
    }
    actions.push({ label: 'Geri al', run: () => void moveBack(note.id, from) })
    showToast({ message: `Taşındı: ${show(to)}`, actions })
  }
  async function moveBack(id: string, path: string[]) {
    const n = noteById(id)
    if (n) await store.move(n, path)
  }

  /** Moves or renames a folder with everything in it (rule 2). */
  async function relocateFolder(folder: string[], newFolder: string[], undoable = true) {
    const r = await store.moveFolder(folder, newFolder)
    if ('error' in r) return showToast({ message: r.error, error: true })
    if (selectedPath && pathStartsWith(selectedPath, folder)) setSelectedPath([...newFolder, ...selectedPath.slice(folder.length)])
    showToast({
      message: `${show(folder)} → ${show(newFolder)} (${r.moved} not)`,
      // Undo only when nothing was merged into an existing folder.
      actions: undoable && !r.merged ? [{ label: 'Geri al', run: () => void relocateFolder(newFolder, folder, false) }] : [],
    })
  }

  function unlockNote(n: Note) {
    const folder = findProtectedAncestor(state.folders, n.path)
    if (folder) void store.unlock(folder.pathKey)
  }


  return (
    <>
      <PasswordModal request={state.pwdRequest} />
      <ConfirmHost />
      <ToastHost />
      {touring && <Tour onClose={closeTour} />}
      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
      {readerNote && readerContent && (
        <Reader
          note={readerNote}
          content={readerContent}
          terms={terms}
          hasPrev={readerIndex > 0}
          hasNext={readerIndex >= 0 && readerIndex < reader!.list.length - 1}
          onPrev={() => setReader({ ...reader!, id: reader!.list[readerIndex - 1] })}
          onNext={() => setReader({ ...reader!, id: reader!.list[readerIndex + 1] })}
          onClose={() => setReader(null)}
          onImageClick={setLightbox}
        />
      )}
      <datalist id={PATH_OPTIONS_ID}>
        {paths.map((p) => <option key={p} value={p} />)}
      </datalist>

      <main className="page">
        <header className="topbar">
          <nav className="view-tabs" aria-label="Görünüm">
            <button className={view === 'notes' ? 'on' : ''} onClick={() => setView('notes')}>
              <NotebookPen size={14} /> Notlar
            </button>
            <button className={view === 'reminders' ? 'on' : ''} data-tour="reminders-tab" onClick={() => setView('reminders')}>
              <AlarmClock size={14} /> Hatırlatmalar {reminderCount > 0 && <span className="tab-count">{reminderCount}</span>}
            </button>
          </nav>
          <div className="topbar-actions">
            <ThemeToggle />
            <button
              className="btn btn-ghost"
              data-tour="help"
              title="Kullanım turu"
              aria-label="Kullanım turu"
              onClick={() => {
                setView('notes')
                setTourOpen(true)
              }}
            >
              <CircleHelp size={14} />
            </button>
            <span className="user-chip" title={user.email}>
              {user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : <span className="user-initial">{(user.name || user.email)[0].toLocaleUpperCase('tr')}</span>}
              <span className="user-name">{user.name || user.email}</span>
            </span>
            <button className="btn btn-ghost" onClick={onLogout} title="Çıkış"><LogOut size={14} /></button>
          </div>
        </header>

        {state.syncError && (
          <div className="banner-error">
            {state.syncError}
            <button className="icon-btn" onClick={() => store.dismissError()} aria-label="Kapat"><X size={12} /></button>
          </div>
        )}

        {view === 'reminders' ? (
          <RemindersPage notes={state.notes} contentOf={contentOf} onOpenReader={openReader} />
        ) : (
          <>
        <UpcomingStrip notes={state.notes} contentOf={contentOf} onShowAll={() => setView('reminders')} />

        <div className="search" data-tour="search">
          <Search size={14} className="search-icon" />
          <input placeholder="Notlarda ara... (anlamına göre de bulur)" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && <button className="icon-btn search-clear" onClick={() => setQuery('')} aria-label="Temizle"><X size={13} /></button>}
        </div>

        <div className="layout">
          <div className="sidebar-wrap" data-tour="tree">
            <Sidebar
              tree={tree}
              selectedPath={selectedPath}
              folders={state.folders}
              keys={state.keys}
              folderPaths={paths}
              onSelect={setSelectedPath}
              onLockClick={onLockClick}
              onDropNote={(id, path) => {
                const n = state.notes.find((x) => x.id === id)
                if (n) void moveNote(n, path, false)
              }}
              onMoveFolder={(folder, parent) => void relocateFolder(folder, folderInto(folder, parent))}
              onRenameFolder={(folder, name) => void relocateFolder(folder, folderRenamed(folder, name))}
            />
            {treeError && <div className="error" style={{ marginTop: 6 }}>{treeError}</div>}
          </div>

          <section className="notes">
            {searching ? (
              selectedPath && <div className="crumb muted">Tüm notlarda aranıyor (seçili klasör: {selectedPath.join(' / ')})</div>
            ) : (
              selectedPath && <div className="crumb">{selectedPath.join(' / ')}</div>
            )}
            {query.trim().length >= 2 && (
              <div className="search-note" data-state={semantic.loading ? 'loading' : semantic.ids ? 'done' : 'off'}>
                {semantic.loading ? <Loader2 size={11} className="spin" /> : <Sparkles size={11} />}
                {keywordHits.length} kelime eşleşmesi
                {semantic.ids && ` · ${meaningHits.length} anlamca ilgili`}
                {semantic.loading && ' · AI anlamca arıyor...'}
              </div>
            )}
            {semantic.error && query.trim().length >= 2 && <div className="search-error">{semantic.error}</div>}
            {!state.loaded ? (
              <div className="muted">Yükleniyor...</div>
            ) : visible.length === 0 ? (
              <div className="muted empty">{state.notes.length ? 'Bu görünümde not yok.' : 'Henüz not yok. Aşağıdan ilk notunu yaz.'}</div>
            ) : (
              visible.map((n) => (
                <NoteCard
                  key={n.id}
                  note={n}
                  content={contentOf(n)}
                  pathOptionsId={PATH_OPTIONS_ID}
                  folderPaths={paths}
                  terms={searching ? terms : undefined}
                  meaningMatch={meaningIds.has(n.id)}
                  onOpenReader={() => openReader(n.id, visible.map((x) => x.id))}
                  onMove={(note, path, exact) => void moveNote(note, path, exact)}
                  tourTarget={n.id === visible.find((x) => contentOf(x))?.id}
                  onSelectPath={setSelectedPath}
                  onImageClick={setLightbox}
                  onUnlock={() => unlockNote(n)}
                />
              ))
            )}
          </section>
        </div>
          </>
        )}
      </main>

      <Composer selectedPath={selectedPath} pathOptionsId={PATH_OPTIONS_ID} />
    </>
  )
}
