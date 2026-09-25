// Jumping to the composer from elsewhere ("Bu klasöre not ekle").
//
// A one-line event instead of a ref through three components: the notes page
// and the folder menu ask, and whichever composer is on screen answers.

const EVENT = 'notex-focus-composer'

/** Opens the composer, ready to write, with the folder already chosen. */
export function focusComposer() {
  window.dispatchEvent(new Event(EVENT))
}

export function onFocusComposer(fn: () => void): () => void {
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}
