import { useEffect, useMemo, useState } from 'react'
import { AlarmClock, Loader2, LogOut, NotebookPen, Search, Sparkles, X } from 'lucide-react'
import { clearSearchCache, useSemanticSearch } from '../ai/useAi'
import { isReminderNote } from '../lib/agenda'
import { queryTerms } from '../lib/highlight'
import { matchesQuery } from '../lib/notes'
import { allPaths, buildTree, findProtectedAncestor, pathKeyOf, pathStartsWith } from '../lib/tree'
import type { User } from '../lib/api'
import type { Note } from '../lib/types'
import { store, useNotex } from '../state/store'
import Composer from './Composer'
import { ConfirmHost } from './ConfirmDialog'
import Lightbox from './Lightbox'
import NoteCard from './NoteCard'
import PasswordModal from './PasswordModal'
import Reader from './Reader'
import RemindersPage from './RemindersPage'
import UpcomingStrip from './UpcomingStrip'
import Sidebar from './Sidebar'

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

  function unlockNote(n: Note) {
    const folder = findProtectedAncestor(state.folders, n.path)
    if (folder) void store.unlock(folder.pathKey)
  }


  return (
    <>
      <PasswordModal request={state.pwdRequest} />
      <ConfirmHost />
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
            <button className={view === 'reminders' ? 'on' : ''} onClick={() => setView('reminders')}>
              <AlarmClock size={14} /> Hatırlatmalar {reminderCount > 0 && <span className="tab-count">{reminderCount}</span>}
            </button>
          </nav>
          <div className="topbar-actions">
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

        <div className="search">
          <Search size={14} className="search-icon" />
          <input placeholder="Notlarda ara... (anlamına göre de bulur)" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && <button className="icon-btn search-clear" onClick={() => setQuery('')} aria-label="Temizle"><X size={13} /></button>}
        </div>

        <div className="layout">
          <div className="sidebar-wrap">
            <Sidebar
              tree={tree}
              selectedPath={selectedPath}
              folders={state.folders}
              keys={state.keys}
              onSelect={setSelectedPath}
              onLockClick={onLockClick}
              onDropNote={(id, path) => {
                const n = state.notes.find((x) => x.id === id)
                if (n) void store.move(n, path)
              }}
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
