// Image helpers (browser only).
// Images are shrunk before saving: they are stored inline as data URLs for now
// (see PROJECT_LOG "Open questions"), and Neon's free tier has 0.5 GB. Inline
// means every image rides along in every GET /api/notes, so what they weigh
// is what the app costs to open.

const MAX_SIDE = 1600
/** Resizing a photo already threw most of the detail away; 0.85 is plenty. */
const QUALITY = 0.85
/**
 * An image that already fitted is usually a screenshot or a diagram, where
 * lossy artefacts show on text, so those are encoded more carefully.
 */
const QUALITY_UNSCALED = 0.92
/** Above this an animated GIF rides along in every load, so a still is taken. */
const MAX_GIF = 2_000_000

let webpSupport: boolean | null = null
/** Every current browser can write WebP from a canvas; Safari before 14 cannot. */
function webpSupported(): boolean {
  if (webpSupport === null) {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    webpSupport = c.toDataURL('image/webp').startsWith('data:image/webp')
  }
  return webpSupport
}

/** The size an image is stored at: never wider or taller than `max`. */
export function fitted(width: number, height: number, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale), scaled: scale < 1 }
}

/**
 * Whichever data URL is shorter. Re-encoding can make a small flat image
 * *bigger* (a two-colour PNG beats any lossy codec), and what matters is the
 * number of characters stored, not the file on disk.
 */
export const smaller = (a: string, b: string) => (b.length < a.length ? b : a)

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

/**
 * File/Blob -> data URL, no larger than 1600px and re-encoded as WebP (JPEG
 * where WebP cannot be written). The result is only kept if it is actually
 * smaller than what came in, so this never makes an image heavier.
 */
export async function fileToDataUrl(file: Blob): Promise<string> {
  const original = await readAsDataUrl(file)
  // SVG is text, usually tiny, and rasterising it would only make it worse.
  if (file.type === 'image/svg+xml') return original
  // A GIF keeps its animation unless it is big enough to hurt every load.
  if (file.type === 'image/gif' && file.size <= MAX_GIF) return original

  const img = new Image()
  img.src = original
  await img.decode()
  const { width, height, scaled } = fitted(img.naturalWidth, img.naturalHeight)
  const webp = webpSupported()
  // Without WebP the fallback is JPEG, which has no transparency. Rather than
  // flatten a small transparent PNG onto white, leave it exactly as it was.
  if (!webp && !scaled && file.size < 300_000) return original

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  if (!webp) {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
  }
  ctx.drawImage(img, 0, 0, width, height)
  return smaller(original, canvas.toDataURL(webp ? 'image/webp' : 'image/jpeg', scaled ? QUALITY : QUALITY_UNSCALED))
}

/**
 * Makes any image source storable: a data URL is shrunk, a web URL is fetched
 * (directly if the site allows it, otherwise through our server's
 * /api/image-proxy) and shrunk. Returns null if the image can't be loaded.
 */
export async function resolveImageSrc(src: string): Promise<string | null> {
  try {
    if (src.startsWith('data:')) return await fileToDataUrl(await (await fetch(src)).blob())
    if (!/^https?:\/\//i.test(src)) return null
    let blob: Blob | null = null
    try {
      const direct = await fetch(src, { mode: 'cors', credentials: 'omit' })
      if (direct.ok) blob = await direct.blob()
    } catch {
      /* blocked by CORS: use the proxy */
    }
    if (!blob || !blob.type.startsWith('image/')) {
      const proxied = await fetch(`/api/image-proxy?url=${encodeURIComponent(src)}`, { credentials: 'same-origin' })
      if (!proxied.ok) return null
      blob = await proxied.blob()
    }
    return blob.type.startsWith('image/') ? await fileToDataUrl(blob) : null
  } catch {
    return null
  }
}

export function imageFilesFrom(list: FileList | DataTransferItemList | null | undefined): File[] {
  if (!list) return []
  const files: File[] = []
  for (const item of Array.from(list as ArrayLike<File | DataTransferItem>)) {
    const f = item instanceof File ? item : item.kind === 'file' ? item.getAsFile() : null
    if (f && f.type.startsWith('image/')) files.push(f)
  }
  return files
}
