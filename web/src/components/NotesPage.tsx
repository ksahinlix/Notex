import { useEffect, useMemo, useRef, useState } from 'react'
import { AlarmClock, CircleHelp, FolderClosed, Loader2, Lock, LockOpen, LogOut, NotebookPen, Plus, Search, Sparkles, X } from 'lucide-react'
import { clearSearchCache, useSemanticSearch } from '../ai/useAi'
import { buildAgenda, isReminderNote } from '../lib/agenda'
import { queryTerms } from '../lib/highlight'
import { markTourDone, tourDone } from '../lib/tour'
import { isSharedPath, ownNotes, sharedFolders } from '../lib/sharing'
import { folderInto, folderRenamed, noteMoveTarget } from '../lib/move'
import { matchesQuery } from '../lib/notes'
import { allPaths, buildTree, findProtectedAncestor, pathKeyOf, pathStartsWith } from '../lib/tree'
import type { User } from '../lib/api'
import type { Note } from '../lib/types'
import { store, useNotex } from '../state/store'
import { focusComposer } from '../state/composer'
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
import SharedTree from './SharedTree'
import InviteBanner from './InviteBanner'
import LockedCard from './LockedCard'
import VersionTag from './VersionTag'
import { ToastHost } from './ToastHost'
import ThemeToggle from './ThemeToggle'
import Tour from './Tour'

const PATH_OPTIONS_ID = 'notex-paths'

type View = 'notes' | 'reminders'
const viewFromHash = (): View => (location.hash === '#hatirlatmalar' ? 'reminders' : 'notes')

export default function NotesPage({ user, onLogout }: { user: User; onLogout: () => void }) {
  const state = useNotex()
  const [selectedPath, setSelectedPath] = useState<string[] | null>(null)
  /** The folder picked under "Paylaşılan", if any (D18). */
  const [sharedPick, setSharedPick] = useState<{ ownerId: string; path: string[] } | null>(null)
  /** Phones: the folder tree is folded away until asked for. */
  const [treeOpen, setTreeOpen] = useState(false)
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
    void store.load(user.id)
  }, [user.id])

  // Your own tree holds your own notes; folders shared with you are listed
  // apart, under "Paylaşılan" (D18).
  const mine = useMemo(() => ownNotes(state.notes, user.id), [state.notes, user.id])
  const shared = useMemo(() => sharedFolders(state.notes, state.sharedWithMe), [state.notes, state.sharedWithMe])
  const sharedNotes = useMemo(
    () => (sharedPick ? (shared.find((f) => f.ownerId === sharedPick.ownerId && f.path.join('/') === sharedPick.path.join('/'))?.notes ?? []) : []),
    [shared, sharedPick],
  )

  // Reminders live on their own page, not in the notes tree or list.
  const plainNotes = useMemo(() => mine.filter((n) => !isReminderNote(n)), [mine])
  // Reminder counts for the sidebar and the tab bar (checked every minute).
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  const agenda = useMemo(() => buildAgenda(state.notes, now), [state.notes, now])
  const overdueCount = agenda.overdue.length
  // Reminders, not occurrences: a monthly bill counts once.
  const activeReminders = new Set([...agenda.overdue, ...agenda.months.flatMap((m) => m.items), ...agenda.undated].map((i) => i.note.id)).size
  const tree = useMemo(() => buildTree(plainNotes), [plainNotes])
  const paths = useMemo(() => allPaths(tree).map((p) => p.join(' / ')), [tree])
  const contentOf = (n: Note) => store.contentOf(n)

  // "/" jumps to the search box (unless you're typing somewhere).
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
      e.preventDefault()
      setView('notes')
      setTimeout(() => searchRef.current?.focus())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Notes changed: earlier AI search answers may be outdated.
  useEffect(clearSearchCache, [state.notes])

  const scoped = useMemo(
    () =>
      sharedPick
        ? sharedNotes.filter((n) => !isReminderNote(n))
        : selectedPath
          ? plainNotes.filter((n) => pathStartsWith(n.path, selectedPath))
          : plainNotes,
    [plainNotes, selectedPath, sharedPick, sharedNotes],
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
  const visible = !searching ? scoped : [...keywordHits, ...meaningHits]
  const readerIndex = reader ? reader.list.indexOf(reader.id) : -1
  const readerNote = reader ? (byId.get(reader.id) ?? null) : null
  const readerContent = readerNote ? contentOf(readerNote) : undefined
  const openReader = (id: string, list: string[]) => setReader({ id, list })

  async function onLockClick(path: string[]) {
    setTreeError('')
    const pk = pathKeyOf(path)
    // A shared folder can't be locked: the key never leaves this browser, so
    // the other person would see nothing but ciphertext (D8, D18).
    if (isSharedPath(state.shares, path) && !state.folders.some((f) => f.pathKey === pk))
      return setTreeError('Paylaşılan klasör şifrelenemez. Önce paylaşımı kaldır.')
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

  /**
   * Locked notes are shown as one card per locked folder. Key: the protected
   * folder's pathKey (or the note's own folder if none is found).
   */
  const lockKeyOf = (n: Note) => findProtectedAncestor(state.folders, n.path)?.pathKey ?? pathKeyOf(n.path)
  function lockedGroups(notes: Note[]) {
    const m = new Map<string, { key: string; path: string[]; count: number; firstId: string }>()
    for (const n of notes) {
      if (contentOf(n)) continue
      const key = lockKeyOf(n)
      const g = m.get(key) ?? { key, path: key.split('/'), count: 0, firstId: n.id }
      g.count++
      m.set(key, g)
    }
    return m
  }
  const unlockFolder = (key: string) => {
    if (state.folders.some((f) => f.pathKey === key)) void store.unlock(key)
  }

  /** "Yeni not" / "Not yaz": opens the composer (full screen on phones). */
  function newNote() {
    setTreeOpen(false)
    focusComposer()
  }

  function unlockNote(n: Note) {
    const folder = findProtectedAncestor(state.folders, n.path)
    if (folder) void store.unlock(folder.pathKey)
  }


  const userAvatar = user.picture ? (
    <img src={user.picture} alt="" referrerPolicy="no-referrer" />
  ) : (
    <span className="user-initial">{(user.name || user.email)[0].toLocaleUpperCase('tr')}</span>
  )
  const openTour = () => {
    setView('notes')
    setTreeOpen(false)
    setTourOpen(true)
  }

  // Page title: the open folder (or "Tüm notlar"), its parents above it.
  const headPath = sharedPick ? sharedPick.path : selectedPath
  const sharedOwner = sharedPick ? shared.find((f) => f.ownerId === sharedPick.ownerId && f.path.join('/') === sharedPick.path.join('/'))?.ownerName : null
  const crumbParts = [...(sharedOwner ? [`${sharedOwner} paylaştı`] : []), ...(headPath ? headPath.slice(0, -1) : [])]
  const selKey = selectedPath && !sharedPick ? pathKeyOf(selectedPath) : null
  const selProtected = !!selKey && state.folders.some((f) => f.pathKey === selKey)
  const selUnlocked = selProtected && !!state.keys[selKey!]

  const listGroups = lockedGroups(visible)
  const searchLocked = searching ? [...lockedGroups(state.notes).values()] : []

  const card = (n: Note) => (
    <NoteCard
      key={n.id}
      note={n}
      content={contentOf(n)}
      pathOptionsId={PATH_OPTIONS_ID}
      folderPaths={paths}
      terms={searching ? terms : undefined}
      onOpenReader={() => openReader(n.id, visible.map((x) => x.id))}
      onMove={(note, path, exact) => void moveNote(note, path, exact)}
      tourTarget={n.id === visible.find((x) => contentOf(x))?.id}
      onSelectPath={(p) => {
        setQuery('')
        setSelectedPath(p)
        setSharedPick(null)
      }}
      onImageClick={setLightbox}
      onUnlock={() => unlockNote(n)}
    />
  )

  return (
    <div className={`app ${treeOpen ? 'tree-open' : ''} ${touring ? 'touring' : ''}`}>
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

      {/* Computers: the sidebar. Phones: only its folder part, as a sheet. */}
      <aside className="app-sidebar">
        <div className="sb-brand">
          <span className="logo" aria-hidden="true">N</span>
          <span className="wordmark">Notex</span>
        </div>
        <button className="btn btn-primary sb-new" onClick={newNote}>
          <Plus size={17} /> Yeni not
        </button>
        <nav className="sb-nav" aria-label="Görünüm">
          <button className={view === 'notes' ? 'on' : ''} aria-current={view === 'notes' ? 'page' : undefined} onClick={() => setView('notes')}>
            <NotebookPen size={18} /> <span className="grow">Notlar</span> <span className="sb-count">{plainNotes.length}</span>
          </button>
          <button
            className={view === 'reminders' ? 'on' : ''}
            aria-current={view === 'reminders' ? 'page' : undefined}
            data-tour="reminders-tab"
            onClick={() => setView('reminders')}
          >
            <AlarmClock size={18} /> <span className="grow">Hatırlatmalar</span>
            {overdueCount > 0 ? (
              <span className="badge-danger">{overdueCount} gecikmiş</span>
            ) : (
              activeReminders > 0 && <span className="sb-count">{activeReminders}</span>
            )}
          </button>
        </nav>

        {view === 'notes' && (
          <div className="sb-folders" data-tour="tree">
            <div className="sheet-grip" aria-hidden="true" />
            <div className="sheet-head">
              <h2>Klasörler</h2>
              <button className="btn btn-ghost" onClick={newNote}><Plus size={16} /> Not</button>
              <button className="icon-btn" aria-label="Kapat" onClick={() => setTreeOpen(false)}><X size={20} /></button>
            </div>
            <div className="sb-label">KLASÖRLER</div>
            <Sidebar
              tree={tree}
              selectedPath={selectedPath}
              folders={state.folders}
              keys={state.keys}
              folderPaths={paths}
              shares={state.shares}
              onSelect={(p) => {
                setSelectedPath(p)
                setSharedPick(null)
                setTreeOpen(false)
              }}
              onLockClick={onLockClick}
              onDropNote={(id, path) => {
                const n = state.notes.find((x) => x.id === id)
                if (n) void moveNote(n, path, false)
              }}
              onMoveFolder={(folder, parent) => void relocateFolder(folder, folderInto(folder, parent))}
              onRenameFolder={(folder, name) => void relocateFolder(folder, folderRenamed(folder, name))}
            />
            <SharedTree
              folders={shared}
              selected={sharedPick}
              onSelect={(pick) => {
                setSharedPick(pick)
                if (pick) setSelectedPath(null)
                setTreeOpen(false)
              }}
            />
            {treeError && <div className="error" style={{ marginTop: 6 }}>{treeError}</div>}
          </div>
        )}

        <div className="sb-footer">
          <span className="user-chip" title={user.email}>
            {userAvatar}
            <span className="user-name">{user.name || user.email}</span>
          </span>
          <ThemeToggle />
          <button className="btn btn-ghost" data-tour="help" title="Kullanım turu" aria-label="Kullanım turu" onClick={openTour}>
            <CircleHelp size={18} />
          </button>
          <button className="btn btn-ghost" onClick={onLogout} title="Çıkış" aria-label="Çıkış"><LogOut size={18} /></button>
        </div>
      </aside>
      <div className="sheet-veil" onClick={() => setTreeOpen(false)} />

      <main className="page">
        <div className="page-col">
          <header className="mobile-header">
            <span className="logo" aria-hidden="true">N</span>
            <span className="wordmark">Notex</span>
            <ThemeToggle />
            <button className="btn btn-ghost" data-tour="help" title="Kullanım turu" aria-label="Kullanım turu" onClick={openTour}>
              <CircleHelp size={18} />
            </button>
            <button className="btn btn-ghost" onClick={onLogout} title="Çıkış" aria-label="Çıkış"><LogOut size={18} /></button>
            <span className="user-chip" title={user.email} style={{ flex: 'none' }}>{userAvatar}</span>
          </header>

          {state.syncError && (
            <div className="banner-error">
              {state.syncError}
              <button className="icon-btn" onClick={() => store.dismissError()} aria-label="Kapat"><X size={14} /></button>
            </div>
          )}

          {view === 'reminders' ? (
            <div className="page-head">
              <div className="page-head-main">
                <h1 className="page-title">Hatırlatmalar</h1>
                <span className="page-count">
                  {activeReminders} aktif{overdueCount > 0 && <> · <span className="overdue">{overdueCount} gecikmiş</span></>}
                </span>
              </div>
            </div>
          ) : (
            <>
              <InviteBanner invites={state.sharedWithMe} />
              <UpcomingStrip notes={state.notes} contentOf={contentOf} onShowAll={() => setView('reminders')} />

              <div className="search" data-tour="search">
                <Search size={17} className="search-icon" />
                <input
                  ref={searchRef}
                  aria-label="Notlarda ara"
                  placeholder="Notlarda ara… anlamına göre de bulur"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
                />
                {query ? (
                  <button className="icon-btn search-clear" onClick={() => setQuery('')} aria-label="Aramayı temizle"><X size={16} /></button>
                ) : (
                  <kbd className="search-key" title="Aramaya geçmek için / tuşuna bas">/</kbd>
                )}
              </div>

              {!searching && (
                <>
                  <div className="page-head">
                    <div className="page-head-main">
                      {crumbParts.length > 0 && <div className="page-crumb">{crumbParts.join(' › ')} ›</div>}
                      <div className="page-title-row">
                        <h1 className="page-title">{headPath ? headPath[headPath.length - 1] : 'Tüm notlar'}</h1>
                        <span className="page-count">{scoped.length} not</span>
                      </div>
                    </div>
                    {selectedPath && !sharedPick && (
                      <div className="page-actions">
                        <button className="btn btn-ghost" onClick={() => void onLockClick(selectedPath)}>
                          {selUnlocked ? <LockOpen size={16} /> : <Lock size={16} />}
                          {!selProtected ? 'Şifrele' : selUnlocked ? 'Kilitle' : 'Kilidi aç'}
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {/* One composer for both views, so a draft survives switching. */}
          <div className={`composer-slot ${searching && view === 'notes' ? 'searching' : ''}`}>
            <Composer selectedPath={sharedPick ? sharedPick.path : selectedPath} pathOptionsId={PATH_OPTIONS_ID} sharedOwnerId={sharedPick?.ownerId} />
          </div>

          {view === 'reminders' ? (
            <RemindersPage
              notes={state.notes}
              contentOf={contentOf}
              onOpenReader={openReader}
              pathOptionsId={PATH_OPTIONS_ID}
              folderPaths={paths}
              onRenameFolder={(folder, name) => void relocateFolder(folder, folderRenamed(folder, name))}
            />
          ) : searching ? (
            // Search covers ALL notes (not just the selected folder): notes
            // containing the words first, then notes the AI found by meaning
            // (D15). Locked notes can't be searched: they get a card saying so.
            <div className="results">
              <div className="results-summary">
                Tüm notlarda arandı{selectedPath && ` (seçili klasör: ${selectedPath.join(' / ')})`} ·{' '}
                <b>{keywordHits.length + meaningHits.length} sonuç</b>
              </div>
              <section className="result-group">
                <h2 className="result-title">
                  <Search size={17} /> Kelimeyle eşleşenler <span className="count">{keywordHits.length}</span>
                </h2>
                {keywordHits.length ? keywordHits.map(card) : <div className="result-empty">Bu kelimeler hiçbir notta geçmiyor.</div>}
              </section>
              {query.trim().length >= 2 && (
                <section className="result-group meaning" data-state={semantic.loading ? 'loading' : semantic.ids ? 'done' : 'off'}>
                  <h2 className="result-title">
                    {semantic.loading ? <Loader2 size={17} className="spin" /> : <Sparkles size={17} />} Anlamca ilgili
                    {semantic.ids && <span className="count">{meaningHits.length}</span>}
                    <span className="result-hint">
                      {semantic.loading ? 'AI anlamca arıyor…' : 'aynı kelimeler yok ama konu yakın'}
                    </span>
                  </h2>
                  {semantic.error && <div className="search-error">{semantic.error}</div>}
                  {meaningHits.map(card)}
                  {semantic.ids && !meaningHits.length && <div className="result-empty">Başka ilgili not bulunamadı.</div>}
                </section>
              )}
              {searchLocked.map((g) => (
                <LockedCard key={g.key} path={g.path} count={g.count} searching onUnlock={() => unlockFolder(g.key)} />
              ))}
            </div>
          ) : (
            <section className="notes">
              {!state.loaded ? (
                <div className="muted">Yükleniyor...</div>
              ) : visible.length === 0 ? (
                <div className="muted empty">{state.notes.length ? 'Bu görünümde not yok.' : 'Henüz not yok. İlk notunu yaz; klasörünü AI seçsin.'}</div>
              ) : (
                visible.map((n) => {
                  if (contentOf(n)) return card(n)
                  const g = listGroups.get(lockKeyOf(n))
                  return g && g.firstId === n.id ? <LockedCard key={`lock:${g.key}`} path={g.path} count={g.count} onUnlock={() => unlockFolder(g.key)} /> : null
                })
              )}
            </section>
          )}
          <VersionTag />
        </div>
      </main>

      {/* Phones only (CSS): the "Not yaz" button and the tab bar. */}
      <button className="fab" data-tour="composer" onClick={newNote}>
        <Plus size={20} /> Not yaz
      </button>
      <nav className="tabbar" aria-label="Ana menü">
        <button className={view === 'notes' && !treeOpen ? 'on' : ''} onClick={() => { setView('notes'); setTreeOpen(false) }}>
          <span className="tab-icon"><NotebookPen size={20} /></span>Notlar
        </button>
        <button className={treeOpen ? 'on' : ''} data-tour="tree" onClick={() => { setView('notes'); setTreeOpen(true) }}>
          <span className="tab-icon"><FolderClosed size={20} /></span>Klasörler
        </button>
        <button className={view === 'reminders' && !treeOpen ? 'on' : ''} data-tour="reminders-tab" onClick={() => { setView('reminders'); setTreeOpen(false) }}>
          <span className="tab-icon">
            <AlarmClock size={20} />
            {overdueCount > 0 && <span className="tab-badge">{overdueCount}</span>}
          </span>
          Hatırlatmalar
        </button>
      </nav>
    </div>
  )
}
