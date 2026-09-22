// Folder encryption, done entirely in the browser (Web Crypto API).
// The folder password and the derived key never leave the device.
//
// Changed from the prototype:
// - No password hash is stored. The prototype stored sha256(password + salt),
//   which is fast to brute-force and made PBKDF2 pointless. Now we encrypt a
//   known value (`checkCipher`) and a password is correct iff it decrypts.
// - PBKDF2 iterations raised from 100k to 600k (OWASP recommendation).

import type { ProtectedFolder } from './types'

export const PBKDF2_ITERATIONS = 600_000
const CHECK_VALUE = 'notex-folder-check-v1'

const enc = new TextEncoder()
const dec = new TextDecoder()

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin)
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function deriveKey(password: string, saltHex: string, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Encrypts any JSON value. Output: "ivB64:ciphertextB64". */
export async function encryptJson(key: CryptoKey, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value)))
  return `${bytesToB64(iv)}:${bytesToB64(new Uint8Array(ct))}`
}

/** Throws if the key is wrong or the data was tampered with. */
export async function decryptJson<T>(key: CryptoKey, payload: string): Promise<T> {
  const [ivB64, ctB64] = payload.split(':')
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(ivB64) }, key, b64ToBytes(ctB64))
  return JSON.parse(dec.decode(plain)) as T
}

/** Creates the stored record for a newly protected folder, plus its key. */
export async function createProtectedFolder(pathKey: string, password: string): Promise<{ folder: ProtectedFolder; key: CryptoKey }> {
  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)))
  const key = await deriveKey(password, salt)
  const checkCipher = await encryptJson(key, CHECK_VALUE)
  return { folder: { pathKey, salt, iterations: PBKDF2_ITERATIONS, checkCipher }, key }
}

/** Returns the folder key if the password is right, otherwise null. */
export async function unlockFolder(folder: ProtectedFolder, password: string): Promise<CryptoKey | null> {
  const key = await deriveKey(password, folder.salt, folder.iterations)
  try {
    return (await decryptJson<string>(key, folder.checkCipher)) === CHECK_VALUE ? key : null
  } catch {
    return null
  }
}
