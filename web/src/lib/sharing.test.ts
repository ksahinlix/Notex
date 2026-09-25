import { describe, expect, it } from 'vitest'
import { initials, inviteTokenFrom, isSharedPath, ownNotes, personColor, shareMark, shareOf, sharedFolders, sharePeople, shareSummary, sharesForPath } from './sharing'
import type { Note, Share } from './types'

const ME = 'me-id'
const KAAN = { id: 'kaan-id', name: 'Kaan', email: 'kaan@example.com', picture: null }

let n = 0
const note = (extra: Partial<Note>): Note => ({
  id: `n${++n}`, path: ['Alışveriş'], encrypted: false, content: { text: 'süt' }, cipher: null,
  isListItem: false, checked: false, reminderAt: null, ownerId: ME,
  createdAt: '2026-09-01T09:00:00Z', updatedAt: '2026-09-01T09:00:00Z', ...extra,
})
const share = (extra: Partial<Share>): Share => ({
  id: `s${++n}`, path: ['Alışveriş'], invitedEmail: 'ayse@example.com', status: 'accepted',
  token: 't', createdAt: '2026-09-01T09:00:00Z', person: null, ...extra,
})

describe('sharing', () => {
  it('keeps your tree to your own notes', () => {
    const notes = [note({}), note({ ownerId: KAAN.id }), note({ ownerId: undefined })]
    expect(ownNotes(notes, ME).map((x) => x.ownerId)).toEqual([ME, undefined])
  })

  it('groups the folders shared with you by owner', () => {
    const notes = [
      note({ ownerId: KAAN.id, path: ['Alışveriş'] }),
      note({ ownerId: KAAN.id, path: ['Alışveriş', 'Market'] }), // a subfolder comes along
      note({ ownerId: KAAN.id, path: ['Kişisel'] }), // not in the shared folder
      note({ path: ['Alışveriş'] }), // your own folder of the same name
    ]
    const folders = sharedFolders(notes, [share({ owner: KAAN })])
    expect(folders).toHaveLength(1)
    expect(folders[0].ownerName).toBe('Kaan')
    expect(folders[0].notes.map((x) => x.path.join('/'))).toEqual(['Alışveriş', 'Alışveriş/Market'])
  })

  it('ignores a share that has not been accepted', () => {
    const notes = [note({ ownerId: KAAN.id })]
    expect(sharedFolders(notes, [share({ owner: KAAN, status: 'pending' })])).toEqual([])
  })

  it('tells which share a note came from', () => {
    const withMe = [share({ owner: KAAN })]
    expect(shareOf(note({ ownerId: KAAN.id }), withMe, ME)?.owner?.name).toBe('Kaan')
    expect(shareOf(note({}), withMe, ME)).toBeNull() // your own note
    expect(shareOf(note({ ownerId: KAAN.id, path: ['Kişisel'] }), withMe, ME)).toBeNull()
  })

  it('finds who a folder of yours is shared with, parents included', () => {
    const mine = [share({ path: ['Ev'] }), share({ path: ['İş'] })]
    expect(sharesForPath(mine, ['Ev', 'Alışveriş']).map((s) => s.path)).toEqual([['Ev']])
    expect(sharesForPath(mine, ['Tatil'])).toEqual([])
  })

  it('knows a path may not be locked when sharing touches it', () => {
    const mine = [share({ path: ['Ev', 'Alışveriş'] })]
    expect(isSharedPath(mine, ['Ev', 'Alışveriş'])).toBe(true)
    expect(isSharedPath(mine, ['Ev', 'Alışveriş', 'Market'])).toBe(true) // inside it
    expect(isSharedPath(mine, ['Ev'])).toBe(true) // contains it
    expect(isSharedPath(mine, ['İş'])).toBe(false)
  })

  it('reads the token out of an invite link', () => {
    expect(inviteTokenFrom({ pathname: '/davet/abc123', hash: '' })).toBe('abc123')
    expect(inviteTokenFrom({ pathname: '/davet/abc123/', hash: '' })).toBe('abc123')
    expect(inviteTokenFrom({ pathname: '/', hash: '#davet=abc123' })).toBe('abc123')
    expect(inviteTokenFrom({ pathname: '/', hash: '#hatirlatmalar' })).toBeNull()
    expect(inviteTokenFrom({ pathname: '/davet/', hash: '' })).toBeNull()
  })

  it('says who a folder is shared with', () => {
    expect(shareSummary([share({ person: { id: 'a', name: 'Ayşe', email: 'ayse@example.com', picture: null } })])).toBe('Ayşe ile paylaşıldı')
    expect(shareSummary([share({ status: 'pending' })])).toBe('ayse ile paylaşıldı · 1 davet bekliyor')
    const two = [
      share({ person: { id: 'a', name: 'Ayşe', email: 'a@x.com', picture: null } }),
      share({ person: { id: 'b', name: 'Irmak', email: 'i@x.com', picture: null } }),
    ]
    expect(shareSummary(two)).toBe('Ayşe ve Irmak ile paylaşıldı')
    expect(shareSummary([])).toBe('')
  })
})

describe('the shared mark on a note', () => {
  const AYSE = { id: 'ayse-id', name: 'Ayşe', email: 'ayse@example.com', picture: null }

  it('says who your folder is shared with', () => {
    const mine = [share({ path: ['Alışveriş'], person: AYSE })]
    expect(shareMark(note({ path: ['Alışveriş', 'Market'] }), mine, [], ME)).toBe('Ayşe ile paylaşıldı')
  })

  it('counts invitations that are still waiting', () => {
    const mine = [share({ path: ['Alışveriş'], status: 'pending' })]
    expect(shareMark(note({}), mine, [], ME)).toBe('ayse ile paylaşıldı · 1 davet bekliyor')
  })

  it('says whose folder it is when someone shared it with you', () => {
    const withMe = [share({ owner: KAAN })]
    expect(shareMark(note({ ownerId: KAAN.id }), [], withMe, ME)).toBe('Kaan paylaştı')
  })

  it('stays out of the way for a note nobody else can see', () => {
    expect(shareMark(note({}), [], [], ME)).toBeNull()
    expect(shareMark(note({ path: ['Kişisel'] }), [share({ path: ['Alışveriş'] })], [], ME)).toBeNull()
  })
})

describe('faces on a shared note', () => {
  const AYSE = { id: 'ayse-id', name: 'Ayşe Yılmaz', email: 'ayse@example.com', picture: null }

  it('takes initials the way Google does, and copes without a name', () => {
    expect(initials({ name: 'Kaan Berk Şahinli', email: 'k@x.com' })).toBe('KB')
    expect(initials({ name: 'Irmak', email: 'i@x.com' })).toBe('I')
    expect(initials({ name: null, email: 'ayse@example.com' })).toBe('A')
    expect(initials({ name: '  ', email: 'ömer@x.com' })).toBe('Ö')
  })

  it('gives the same person the same colour every time', () => {
    expect(personColor('ayse-id')).toBe(personColor('ayse-id'))
    expect(personColor('ayse-id')).not.toBe(personColor('kaan-id'))
  })

  it('shows the owner for a folder shared with you', () => {
    const got = sharePeople(note({ ownerId: KAAN.id }), [], [share({ owner: KAAN })], ME)
    expect(got?.theirs).toBe(true)
    expect(got?.people.map((p) => p.name)).toEqual(['Kaan'])
    expect(got?.label).toBe('Kaan paylaştı')
  })

  it('shows everyone you shared your folder with, invited or not yet joined', () => {
    const mine = [share({ path: ['Alışveriş'], person: AYSE }), share({ path: ['Alışveriş'], invitedEmail: 'irmak@example.com', status: 'pending', person: null })]
    const got = sharePeople(note({ path: ['Alışveriş'] }), mine, [], ME)
    expect(got?.theirs).toBe(false)
    expect(got?.people.map((p) => p.email)).toEqual(['ayse@example.com', 'irmak@example.com'])
    expect(got?.label).toBe('Ayşe Yılmaz ve irmak ile paylaşıldı · 1 davet bekliyor')
  })

  it('shows nothing for a note only you can see', () => {
    expect(sharePeople(note({}), [], [], ME)).toBeNull()
  })
})
