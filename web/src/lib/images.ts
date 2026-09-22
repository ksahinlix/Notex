// Image helpers (browser only).
// Images are shrunk before saving: they are stored inline as data URLs for now
// (see PROJECT_LOG "Open questions"), and Neon's free tier has 0.5 GB.

const MAX_SIDE = 1600
const JPEG_QUALITY = 0.82

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

/** File -> data URL, downscaled to at most 1600px and re-encoded as JPEG (PNG/GIF kept if small). */
export async function fileToDataUrl(file: File): Promise<string> {
  const original = await readAsDataUrl(file)
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return original
  const img = new Image()
  img.src = original
  await img.decode()
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
  if (scale === 1 && file.size < 300_000) return original
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * scale)
  canvas.height = Math.round(img.naturalHeight * scale)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff' // JPEG has no transparency
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
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
