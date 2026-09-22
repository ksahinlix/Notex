import { useState, useEffect, useRef } from "react";
import {
  Search, Clock, X, Plus, Loader2, Sparkles, ChevronRight, ChevronDown,
  Lock, LockOpen, Check, MessageCircle, ImagePlus, Pencil, Maximize2, Minimize2,
} from "lucide-react";

const COLORS = {
  bg: "#F7F7F8",
  surface: "#FFFFFF",
  border: "#E4E4E7",
  text: "#18181B",
  textMuted: "#71717A",
  accent: "#3B4DE0",
  accentSoft: "#EEF0FD",
  reminder: "#C2760C",
  reminderSoft: "#FBF1E3",
  danger: "#B42318",
  warn: "#B54708",
  warnSoft: "#FEF6E7",
  ok: "#15803D",
  okSoft: "#EDFBF2",
};

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
function stripFences(text) { return text.replace(/```json/g, "").replace(/```/g, "").trim(); }

async function callClaudeRaw(systemPrompt, userPrompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  const data = await res.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("Boş yanıt");
  return textBlock.text;
}
async function callClaudeJson(systemPrompt, userPrompt) {
  const text = await callClaudeRaw(systemPrompt, userPrompt);
  return JSON.parse(stripFences(text));
}

// ---- crypto helpers ----
function bytesToHex(bytes) { return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(""); }
function hexToBytes(hex) { const b = new Uint8Array(hex.length / 2); for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.substr(i * 2, 2), 16); return b; }
function bytesToB64(bytes) { let bin = ""; bytes.forEach((b) => (bin += String.fromCharCode(b))); return btoa(bin); }
function b64ToBytes(b64) { const bin = atob(b64); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; }
async function sha256Hex(str) { const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str)); return bytesToHex(new Uint8Array(buf)); }
function randomSaltHex() { return bytesToHex(crypto.getRandomValues(new Uint8Array(16))); }
async function deriveKey(password, saltHex) {
  const salt = hexToBytes(saltHex);
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function encryptJson(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return bytesToB64(iv) + ":" + bytesToB64(new Uint8Array(cipherBuf));
}
async function decryptJson(key, payload) {
  const [ivB64, ctB64] = payload.split(":");
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(ivB64) }, key, b64ToBytes(ctB64));
  return JSON.parse(new TextDecoder().decode(plainBuf));
}
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---- zengin içerik (metin + satır içi görsel) blokları ----
function pickImgSrc(node) {
  const srcset = node.getAttribute("srcset") || node.getAttribute("data-srcset");
  if (srcset) {
    const candidates = srcset.split(",").map((s) => s.trim().split(/\s+/)).filter((p) => p[0]);
    if (candidates.length) {
      candidates.sort((a, b) => (parseFloat(b[1]) || 0) - (parseFloat(a[1]) || 0));
      return candidates[0][0];
    }
  }
  const dataSrc = node.getAttribute("data-src") || node.getAttribute("data-original") || node.getAttribute("data-lazy-src");
  const src = node.getAttribute("src");
  // src bir 1x1 placeholder gif ya da anlamsız kısa bir veri ise data-src'yi tercih et
  if (dataSrc && (!src || src.startsWith("data:image/gif") || src.length < 100)) return dataSrc;
  return src || dataSrc || "";
}
function normalizeMathUnicode(str) {
  if (!str) return str;
  return str.replace(/[\u{1D400}-\u{1D7FF}]|\u210E/gu, (ch) => {
    const cp = ch.codePointAt(0);
    if (cp === 0x210e) return "h"; // İtalik h için Unicode'un ayrı tuttuğu tarihi istisna
    if (cp >= 0x1d400 && cp <= 0x1d419) return String.fromCharCode(cp - 0x1d400 + 65); // Bold A-Z
    if (cp >= 0x1d41a && cp <= 0x1d433) return String.fromCharCode(cp - 0x1d41a + 97); // Bold a-z
    if (cp >= 0x1d434 && cp <= 0x1d44d) return String.fromCharCode(cp - 0x1d434 + 65); // Italic A-Z
    if (cp >= 0x1d44e && cp <= 0x1d467) return String.fromCharCode(cp - 0x1d44e + 97); // Italic a-z
    if (cp >= 0x1d468 && cp <= 0x1d481) return String.fromCharCode(cp - 0x1d468 + 65); // Bold Italic A-Z
    if (cp >= 0x1d482 && cp <= 0x1d49b) return String.fromCharCode(cp - 0x1d482 + 97); // Bold Italic a-z
    if (cp >= 0x1d7ce && cp <= 0x1d7d7) return String.fromCharCode(cp - 0x1d7ce + 48); // Bold 0-9
    return ch; // tanımadığımız bir matematik varyantı - dokunma
  });
}
function domToBlocks(root) {
  const blocks = [];
  let buffer = "";
  const flush = () => { if (buffer.length) { blocks.push({ type: "text", content: buffer }); buffer = ""; } };
  const blockTags = ["P", "DIV", "LI", "TR", "H1", "H2", "H3", "H4", "H5", "H6"];
  function walk(node) {
    if (node.nodeType === 3) { buffer += normalizeMathUnicode(node.textContent); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName;
    if (tag === "IMG") { flush(); const src = pickImgSrc(node); if (src) blocks.push({ type: "image", src, alt: node.getAttribute("alt") || "" }); return; }
    if (tag === "BR") { buffer += "\n"; return; }
    Array.from(node.childNodes).forEach(walk);
    if (blockTags.includes(tag)) buffer += "\n";
  }
  Array.from(root.childNodes).forEach(walk);
  flush();
  return blocks.filter((b) => b.type === "image" || b.content.trim().length > 0);
}
function trimBlocksEdges(blocks) {
  const arr = blocks.map((b) => ({ ...b }));
  while (arr.length && arr[0].type === "text") {
    arr[0].content = arr[0].content.replace(/^\s+/, "");
    if (arr[0].content === "") arr.shift(); else break;
  }
  while (arr.length && arr[arr.length - 1].type === "text") {
    const idx = arr.length - 1;
    arr[idx].content = arr[idx].content.replace(/\s+$/, "");
    if (arr[idx].content === "") arr.pop(); else break;
  }
  return arr;
}
function blocksToPlainText(blocks) {
  return (blocks || []).filter((b) => b.type === "text").map((b) => b.content.trim()).filter(Boolean).join(" ").trim();
}
async function resolveRemoteImageSrc(src) {
  if (!src) return null;
  if (src.startsWith("data:")) return src;
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return null;
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch (e) {
    // Bu ortamın güvenlik politikası dış domainlerden görsel indirmeyi engelliyor (CORS/CSP) — elimizde kullanılabilir bir görsel yok.
    return null;
  }
}
function insertTextAtCursor(text) { if (text) document.execCommand("insertText", false, normalizeMathUnicode(text)); }
function insertImageAtCursor(src) {
  document.execCommand("insertHTML", false, `<img src="${src}" style="max-width:180px;max-height:180px;border-radius:5px;vertical-align:middle;margin:2px 6px 2px 0;display:inline-block;" />`);
}

function buildTree(notes) {
  const root = { children: {}, count: 0 };
  for (const n of notes) {
    let cur = root;
    cur.count++;
    for (const seg of n.path) {
      if (!cur.children[seg]) cur.children[seg] = { children: {}, count: 0 };
      cur = cur.children[seg];
      cur.count++;
    }
  }
  return root;
}
function serializeTree(node, depth = 0) {
  const keys = Object.keys(node.children);
  if (keys.length === 0) return "";
  return keys.map((k) => "  ".repeat(depth) + "- " + k + "\n" + serializeTree(node.children[k], depth + 1)).join("");
}
function pathStartsWith(path, prefix) { return prefix.every((seg, i) => path[i] === seg); }
function pathKeyOf(pathArr) { return pathArr.join("/"); }

function TreeNode({ name, node, depth, pathSoFar, selectedPath, onSelect, protectedFolders, unlockedKeys, onLockClick, onDropNote }) {
  const [open, setOpen] = useState(depth < 1);
  const [dragOver, setDragOver] = useState(false);
  const keys = Object.keys(node.children);
  const isSelected = selectedPath && selectedPath.join("/") === pathSoFar.join("/");
  const isAncestorOfSelection = selectedPath && pathStartsWith(selectedPath, pathSoFar);
  const effectiveOpen = open || isAncestorOfSelection;
  const pk = pathKeyOf(pathSoFar);
  const protEntry = protectedFolders.find((p) => p.pathKey === pk);
  const isUnlocked = protEntry && unlockedKeys[pk];
  const isLocked = protEntry && !isUnlocked;
  const showChildren = !isLocked && effectiveOpen;
  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
        onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const noteId = e.dataTransfer.getData("text/plain");
          if (noteId) onDropNote(noteId, pathSoFar);
        }}
        style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 8px", paddingLeft: 8 + depth * 14, borderRadius: 5, fontSize: 13, background: dragOver ? COLORS.okSoft : isSelected ? COLORS.accentSoft : "transparent", outline: dragOver ? `1.5px dashed ${COLORS.ok}` : "none", color: isSelected ? COLORS.accent : COLORS.text }}
      >
        <span
          onClick={() => {
            if (isLocked) { onLockClick(pathSoFar); return; }
            onSelect(pathSoFar);
            if (keys.length > 0) setOpen((o) => !o);
          }}
          style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, cursor: "pointer", overflow: "hidden" }}
        >
          {isLocked ? (
            <Lock size={11} style={{ color: COLORS.reminder }} />
          ) : keys.length > 0 ? (
            effectiveOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />
          ) : (
            <span style={{ width: 12 }} />
          )}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        </span>
        <button onClick={() => onLockClick(pathSoFar)} title={protEntry ? (isUnlocked ? "Kilidi kapat" : "Şifre iste") : "Bu klasörü şifreyle koru"} style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: protEntry ? (isUnlocked ? COLORS.ok : COLORS.reminder) : COLORS.textMuted, display: "flex" }}>
          {protEntry ? isUnlocked ? <LockOpen size={12} /> : <Lock size={12} /> : <Lock size={11} style={{ opacity: 0.35 }} />}
        </button>
        {!isLocked && <span style={{ fontSize: 10, color: COLORS.textMuted, minWidth: 12, textAlign: "right" }}>{node.count}</span>}
      </div>
      {showChildren && keys.map((k) => (
        <TreeNode key={k} name={k} node={node.children[k]} depth={depth + 1} pathSoFar={[...pathSoFar, k]} selectedPath={selectedPath} onSelect={onSelect} protectedFolders={protectedFolders} unlockedKeys={unlockedKeys} onLockClick={onLockClick} onDropNote={onDropNote} />
      ))}
    </div>
  );
}

function PasswordModal({ state, onConfirm, onCancel }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  if (!state) return null;
  const isSet = state.mode === "set";
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(24,24,27,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: COLORS.surface, borderRadius: 10, padding: 20, width: 300, border: `1px solid ${COLORS.border}` }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{isSet ? "Klasörü şifreyle koru" : "Şifre gerekli"}</div>
        <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 10 }}>{state.pathKey.split("/").join(" / ")}</div>
        <input type="password" autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && value && onConfirm(value, setError)} placeholder="Şifre" className="na-bc-input" style={{ borderStyle: "solid" }} />
        {error && <div style={{ fontSize: 12, color: COLORS.danger, marginTop: 6 }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button className="na-btn na-btn-ghost" onClick={onCancel}>İptal</button>
          <button className="na-btn na-btn-primary" disabled={!value} onClick={() => onConfirm(value, setError)}>{isSet ? "Belirle" : "Aç"}</button>
        </div>
      </div>
    </div>
  );
}

function ImageLightbox({ src, onClose }) {
  if (!src) return null;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(240,240,242,0.92)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, cursor: "zoom-out" }}>
      <img src={src} onClick={(e) => e.stopPropagation()} style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 6, boxShadow: "0 10px 40px rgba(0,0,0,0.25)", border: "1px solid rgba(0,0,0,0.08)", cursor: "default", background: "#fff" }} />
      <button onClick={onClose} style={{ position: "fixed", top: 16, right: 16, background: "#fff", border: "1px solid rgba(0,0,0,0.12)", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>×</button>
    </div>
  );
}

export default function NoteApp() {
  const [notes, setNotes] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const [input, setInput] = useState("");
  const [breadcrumb, setBreadcrumb] = useState("");
  const [suggestion, setSuggestion] = useState(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [autoMode, setAutoMode] = useState(true);
  const autoModeRef = useRef(true);
  useEffect(() => { autoModeRef.current = autoMode; }, [autoMode]);

  const composerFileInputRef = useRef(null);
  const noteFileInputRef = useRef(null);
  const [imageTargetNoteId, setImageTargetNoteId] = useState(null);
  const [composerEmpty, setComposerEmpty] = useState(true);

  const [selectedPath, setSelectedPath] = useState(null);

  const [query, setQuery] = useState("");
  const [aiSearchLoading, setAiSearchLoading] = useState(false);
  const [aiMatchIds, setAiMatchIds] = useState(null);
  const [aiSearchError, setAiSearchError] = useState("");

  const [protectedFolders, setProtectedFolders] = useState([]);
  const [unlockedKeys, setUnlockedKeys] = useState({});
  const [decryptedCache, setDecryptedCache] = useState({});
  const [pwdModal, setPwdModal] = useState(null);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const pwdResolveRef = useRef(null);

  const [panelState, setPanelState] = useState({}); // noteId -> {type, instruction, loading, result, error, pasted, commentDraft}

  const [quickAddPath, setQuickAddPath] = useState("");
  const [quickAddText, setQuickAddText] = useState("");
  const [quickAddError, setQuickAddError] = useState("");

  const [editingId, setEditingId] = useState(null);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  function toggleExpand(id) {
    setExpandedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  const [editDraft, setEditDraft] = useState("");

  const composerEditableRef = useRef(null);

  useEffect(() => {
    (async () => {
      try { const r1 = await window.storage.get("notes_v4", false); if (r1?.value) setNotes(JSON.parse(r1.value)); } catch (e) {}
      try { const r2 = await window.storage.get("protected_folders_v1", false); if (r2?.value) setProtectedFolders(JSON.parse(r2.value)); } catch (e) {}
      setLoaded(true);
    })();
  }, []);

  async function persistNotes(next) { try { await window.storage.set("notes_v4", JSON.stringify(next), false); } catch (e) { console.error(e); } }
  async function persistProtected(next) { try { await window.storage.set("protected_folders_v1", JSON.stringify(next), false); } catch (e) { console.error(e); } }

  const tree = buildTree(notes);

  function requestPassword(mode, pathKeyArr) {
    return new Promise((resolve) => { pwdResolveRef.current = resolve; setPwdModal({ mode, pathKey: pathKeyOf(pathKeyArr) }); });
  }
  function findProtectedAncestor(pathArr) {
    const key = pathKeyOf(pathArr);
    return protectedFolders.find((p) => key === p.pathKey || key.startsWith(p.pathKey + "/"));
  }

  async function handlePwdConfirm(password, setError) {
    const modal = pwdModal;
    if (!modal) return;
    if (modal.mode === "set") {
      const salt = randomSaltHex();
      const verifierHash = await sha256Hex(password + salt);
      const entry = { pathKey: modal.pathKey, salt, verifierHash };
      const next = [...protectedFolders.filter((p) => p.pathKey !== entry.pathKey), entry];
      setProtectedFolders(next); persistProtected(next);
      const key = await deriveKey(password, salt);
      setUnlockedKeys((prev) => ({ ...prev, [entry.pathKey]: key }));

      // bu klasörün altında zaten var olan şifresiz notları geriye dönük şifrele
      const toConvert = notes.filter((n) => !n.encrypted && pathStartsWith(n.path, entry.pathKey.split("/")));
      if (toConvert.length > 0) {
        const cacheUpdates = {};
        const convertedById = {};
        for (const n of toConvert) {
          const plain = { text: n.text, listItemText: n.listItemText || null, comments: n.comments || [], images: n.images || [] };
          const cipher = await encryptJson(key, plain);
          convertedById[n.id] = cipher;
          cacheUpdates[n.id] = plain;
        }
        const nextNotes = notes.map((n) =>
          convertedById[n.id]
            ? { id: n.id, path: n.path, isReminder: n.isReminder, reminderAt: n.reminderAt, reminderLabel: n.reminderLabel, isListItem: n.isListItem, checked: n.checked, createdAt: n.createdAt, encrypted: true, cipher: convertedById[n.id] }
            : n
        );
        setNotes(nextNotes);
        persistNotes(nextNotes);
        setDecryptedCache((prev) => ({ ...prev, ...cacheUpdates }));
      }

      setPwdModal(null);
      pwdResolveRef.current?.({ ok: true, key, entry });
    } else {
      const entry = protectedFolders.find((p) => p.pathKey === modal.pathKey);
      const hash = await sha256Hex(password + entry.salt);
      if (hash !== entry.verifierHash) { setError("Şifre yanlış."); return; }
      const key = await deriveKey(password, entry.salt);
      setUnlockedKeys((prev) => ({ ...prev, [entry.pathKey]: key }));
      const toDecrypt = notes.filter((n) => n.encrypted && pathStartsWith(n.path, entry.pathKey.split("/")));
      const cacheUpdates = {};
      for (const n of toDecrypt) { try { cacheUpdates[n.id] = await decryptJson(key, n.cipher); } catch (e) {} }
      setDecryptedCache((prev) => ({ ...prev, ...cacheUpdates }));
      setPwdModal(null);
      pwdResolveRef.current?.({ ok: true, key, entry });
    }
  }
  function handlePwdCancel() { setPwdModal(null); pwdResolveRef.current?.({ ok: false }); }

  async function onLockClick(pathArr) {
    const pk = pathKeyOf(pathArr);
    const entry = protectedFolders.find((p) => p.pathKey === pk);
    if (!entry) { await requestPassword("set", pathArr); return; }
    if (unlockedKeys[pk]) {
      setUnlockedKeys((prev) => { const n = { ...prev }; delete n[pk]; return n; });
      setDecryptedCache((prev) => { const n = { ...prev }; notes.filter((x) => pathStartsWith(x.path, pathArr)).forEach((x) => delete n[x.id]); return n; });
      return;
    }
    await requestPassword("unlock", pathArr);
  }

  useEffect(() => {
    setQuickAddPath(selectedPath ? selectedPath.join(" / ") : "");
    setQuickAddText("");
    setQuickAddError("");
  }, [selectedPath]);

  async function handleQuickAdd() {
    const text = quickAddText.trim();
    const path = quickAddPath.split("/").map((s) => s.trim()).filter(Boolean);
    if (!text) return;
    if (path.length < 1) { setQuickAddError("Bir yol belirtmelisin."); return; }
    setQuickAddError("");
    const base = { id: uid(), path, isReminder: false, reminderAt: null, reminderLabel: null, isListItem: false, checked: false, createdAt: new Date().toISOString() };
    const protEntry = findProtectedAncestor(path);
    if (protEntry) {
      let key = unlockedKeys[protEntry.pathKey];
      if (!key) { const r = await requestPassword("unlock", protEntry.pathKey.split("/")); if (!r?.ok) { setQuickAddError("Şifre doğrulanmadan kaydedilemez."); return; } key = r.key; }
      const plain = { text, listItemText: null, comments: [], images: [] };
      const cipher = await encryptJson(key, plain);
      const newNote = { ...base, encrypted: true, cipher };
      const next = [newNote, ...notes]; setNotes(next); persistNotes(next);
      setDecryptedCache((prev) => ({ ...prev, [newNote.id]: plain }));
    } else {
      const newNote = { ...base, encrypted: false, text, listItemText: null, comments: [], images: [] };
      const next = [newNote, ...notes]; setNotes(next); persistNotes(next);
    }
    setQuickAddText("");
  }

  function startEdit(note) {
    const content = getContent(note);
    setEditingId(note.id);
    setEditDraft(note.isListItem ? content.listItemText || content.text : content.text);
  }
  function cancelEdit() { setEditingId(null); setEditDraft(""); }
  async function saveEdit(note) {
    const val = editDraft.trim();
    if (!val) return;
    if (note.encrypted) {
      const entry = findProtectedAncestor(note.path);
      const key = unlockedKeys[entry.pathKey];
      const current = decryptedCache[note.id];
      const updated = note.isListItem ? { ...current, listItemText: val } : { ...current, text: val, blocks: undefined };
      const cipher = await encryptJson(key, updated);
      const next = notes.map((n) => (n.id === note.id ? { ...n, cipher } : n));
      setNotes(next); persistNotes(next);
      setDecryptedCache((prev) => ({ ...prev, [note.id]: updated }));
    } else {
      const field = note.isListItem ? "listItemText" : "text";
      const next = notes.map((n) => (n.id === note.id ? { ...n, [field]: val, ...(note.isListItem ? {} : { blocks: undefined }) } : n));
      setNotes(next); persistNotes(next);
    }
    setEditingId(null); setEditDraft("");
  }

  useEffect(() => {
    if (!autoMode) return;
    const text = input.trim();
    if (text.length < 6) return;
    const t = setTimeout(() => { runSuggest(text); }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, autoMode]);

  async function runSuggest(text) {
    setSuggestLoading(true); setSaveError("");
    try {
      const now = new Date();
      const treeText = serializeTree(tree);
      const system = `Sen kişisel, hiyerarşik bir not uygulamasının sınıflandırma motorusun (OneNote benzeri: Kategori > Klasör > ... > Sayfa, istenilen derinlikte iç içe olabilir).
Şu anki tarih/saat: ${now.toISOString()} (yerel: ${now.toString()}).
Mevcut kategori ağacı:
${treeText || "(henüz hiç kategori yok)"}

ÖNCELİK SIRASI (çok önemli):
1. Önce mevcut ağaçtaki dalları tara. Notla konu olarak İLİŞKİLİ bir dal varsa (tam eşleşme olmasa da), onu kullan — en derin uygun mevcut düğümü bul ve gerekirse altına yeni bir sayfa/alt konu ekle. Var olan bir dalı kullanmak, yeni bir üst kategori icat etmekten HER ZAMAN önceliklidir.
2. Sadece mevcut ağaçta notla gerçekten ilgisi olan HİÇBİR dal yoksa yeni bir üst kategori öner.
3. Yeni bir dal önerirken de olabildiğince SPESİFİK ol (geniş kategori yerine "Yazılım / <Proje> / <Alt Konu>" gibi anlamlı bir dal).
Liste öğesi tespiti: "izlenecek film/dizi", "okunacak kitap", "yapılacak" gibi kalıplar bir kontrol listesi öğesidir — path'i uygun bir liste sayfasına yönlendir (".../İzlenecekler" gibi, varsa mevcut olanı kullan) ve öğenin temiz halini listItemText'e yaz.
Hatırlatma olup olmadığını da tespit et.

SADECE şu şemaya uyan ham JSON döndür:
{"path": [string, ...], "confident": boolean, "alternatives": [[string, ...]], "reason": string, "isReminder": boolean, "reminderAt": string|null, "reminderLabel": string|null, "isListItem": boolean, "listItemText": string|null}
path en az 2 elemanlı olmalı. confident=false ise alternatives 1-2 alternatif tam yol içersin, aksi halde [].`;
      const result = await callClaudeJson(system, `Not: """${text}"""`);
      if (!autoModeRef.current) return;
      setBreadcrumb((result.path || []).join(" / "));
      setSuggestion(result);
    } catch (e) { console.error(e); } finally { setSuggestLoading(false); }
  }
  function applyAlternative(alt) { setBreadcrumb(alt.join(" / ")); }

  function syncComposerPlainText() {
    const el = composerEditableRef.current;
    const text = el ? el.textContent : "";
    setInput(text);
    setComposerEmpty(!el || (el.textContent.trim() === "" && el.querySelectorAll("img").length === 0));
  }

  async function handleComposerFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    composerEditableRef.current?.focus();
    for (const f of files) { const url = await readFileAsDataURL(f); insertImageAtCursor(url); }
    syncComposerPlainText();
  }

  async function handleComposerPaste(e) {
    e.preventDefault();
    const cd = e.clipboardData;
    if (!cd) return;
    const html0 = cd.getData ? cd.getData("text/html") : "";
    const fileImages = Array.from(cd.items || []).filter((it) => it.kind === "file" && it.type.startsWith("image/")).map((it) => it.getAsFile()).filter(Boolean);
    const fileUrls = fileImages.length ? await Promise.all(fileImages.map(readFileAsDataURL)) : [];

    const html = html0;
    if (html && /<img/i.test(html)) {
      // Web sayfası/Word gibi zengin içerikten metin+görsel sırasını koruyarak ekle.
      // Aynı yapıştırmada gerçek görsel dosyası da geldiyse (genelde daha yüksek kalite/doğru görsel),
      // html'deki src yerine onu kullan.
      const doc = new DOMParser().parseFromString(html, "text/html");
      const blocks = domToBlocks(doc.body);
      let fi = 0;
      for (const b of blocks) {
        if (b.type === "text") { insertTextAtCursor(b.content); continue; }
        if (fi < fileUrls.length) { insertImageAtCursor(fileUrls[fi++]); continue; }
        const resolved = await resolveRemoteImageSrc(b.src);
        if (resolved) insertImageAtCursor(resolved);
        else insertTextAtCursor(`[Görsel eklenemedi${b.alt ? ": " + b.alt : ""} — bu kaynaktan indirilemiyor, görüntüyü kaydedip 🖼 ile ekleyebilirsin] `);
      }
      syncComposerPlainText();
      return;
    }
    if (fileUrls.length) {
      for (const url of fileUrls) insertImageAtCursor(url);
      const text = cd.getData("text/plain");
      if (text) insertTextAtCursor(text);
      syncComposerPlainText();
      return;
    }
    const text = cd.getData ? cd.getData("text/plain") : "";
    if (text) insertTextAtCursor(text);
    syncComposerPlainText();
  }

  async function handleComposerDrop(e) {
    e.preventDefault();
    const dt = e.dataTransfer;
    if (!dt) return;
    composerEditableRef.current?.focus();

    const files = Array.from(dt.files || []).filter((f) => f.type.startsWith("image/"));
    if (files.length) {
      for (const f of files) { const url = await readFileAsDataURL(f); insertImageAtCursor(url); }
      syncComposerPlainText();
      return;
    }

    const html = dt.getData ? dt.getData("text/html") : "";
    if (html && /<img/i.test(html)) {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const blocks = domToBlocks(doc.body);
      for (const b of blocks) {
        if (b.type === "text") { insertTextAtCursor(b.content); continue; }
        const resolved = await resolveRemoteImageSrc(b.src);
        if (resolved) insertImageAtCursor(resolved);
        else insertTextAtCursor(`[Görsel eklenemedi${b.alt ? ": " + b.alt : ""} — bu kaynaktan indirilemiyor, görüntüyü kaydedip 🖼 ile ekleyebilirsin] `);
      }
      syncComposerPlainText();
      return;
    }

    const uriList = dt.getData ? dt.getData("text/uri-list") : "";
    const plainText = dt.getData ? dt.getData("text/plain") : "";
    const candidate = (uriList || plainText || "").trim();
    if (/^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg)(\?\S*)?$/i.test(candidate)) {
      const resolved = await resolveRemoteImageSrc(candidate);
      if (resolved) insertImageAtCursor(resolved);
      else insertTextAtCursor(`[Görsel eklenemedi — bu kaynaktan indirilemiyor, görüntüyü kaydedip 🖼 ile ekleyebilirsin] `);
      syncComposerPlainText();
      return;
    }
    if (plainText) { insertTextAtCursor(plainText); syncComposerPlainText(); }
  }

  async function handleSave() {
    const rawBlocks = domToBlocks(composerEditableRef.current || document.createElement("div"));
    const blocks = trimBlocksEdges(rawBlocks);
    const plainText = blocksToPlainText(blocks);
    const hasImage = blocks.some((b) => b.type === "image");
    const path = breadcrumb.split("/").map((s) => s.trim()).filter(Boolean);
    if (!plainText && !hasImage) return;
    if (path.length < 1) { setSaveError("Önce bir kategori/sayfa yolu belirle (AI öner ya da elle yaz)."); return; }
    const now = new Date();
    const base = {
      id: uid(), path,
      isReminder: suggestion?.isReminder || false, reminderAt: suggestion?.reminderAt || null, reminderLabel: suggestion?.reminderLabel || null,
      isListItem: suggestion?.isListItem || false, checked: false, createdAt: now.toISOString(),
    };
    const protEntry = findProtectedAncestor(path);
    if (protEntry) {
      let key = unlockedKeys[protEntry.pathKey];
      if (!key) { const r = await requestPassword("unlock", protEntry.pathKey.split("/")); if (!r?.ok) { setSaveError("Şifre doğrulanmadan kaydedilemez."); return; } key = r.key; }
      const plain = { text: plainText, listItemText: suggestion?.listItemText || null, comments: [], images: [], blocks };
      const cipher = await encryptJson(key, plain);
      const newNote = { ...base, encrypted: true, cipher };
      const next = [newNote, ...notes]; setNotes(next); persistNotes(next);
      setDecryptedCache((prev) => ({ ...prev, [newNote.id]: plain }));
    } else {
      const newNote = { ...base, encrypted: false, text: plainText, listItemText: suggestion?.listItemText || null, comments: [], images: [], blocks };
      const next = [newNote, ...notes]; setNotes(next); persistNotes(next);
    }
    if (composerEditableRef.current) composerEditableRef.current.innerHTML = "";
    setInput(""); setBreadcrumb(""); setSuggestion(null); setSaveError(""); setAutoMode(true); setComposerEmpty(true);
    composerEditableRef.current?.focus();
  }

  function handleDelete(id) { const next = notes.filter((n) => n.id !== id); setNotes(next); persistNotes(next); }
  function toggleChecked(note) { const next = notes.map((n) => (n.id === note.id ? { ...n, checked: !n.checked } : n)); setNotes(next); persistNotes(next); }

  function getContent(note) { return note.encrypted ? decryptedCache[note.id] : note; }

  async function addComment(note, text, source) {
    if (!text || !text.trim()) return;
    const commentObj = { id: uid(), text: text.trim(), source, createdAt: new Date().toISOString() };
    if (note.encrypted) {
      const entry = findProtectedAncestor(note.path);
      const key = unlockedKeys[entry.pathKey];
      const current = decryptedCache[note.id] || { text: "", listItemText: null, comments: [], images: [] };
      const updated = { ...current, comments: [...(current.comments || []), commentObj] };
      const cipher = await encryptJson(key, updated);
      const next = notes.map((n) => (n.id === note.id ? { ...n, cipher } : n));
      setNotes(next); persistNotes(next);
      setDecryptedCache((prev) => ({ ...prev, [note.id]: updated }));
    } else {
      const next = notes.map((n) => (n.id === note.id ? { ...n, comments: [...(n.comments || []), commentObj] } : n));
      setNotes(next); persistNotes(next);
    }
    closePanel(note.id);
  }
  async function deleteComment(note, commentId) {
    if (note.encrypted) {
      const entry = findProtectedAncestor(note.path);
      const key = unlockedKeys[entry.pathKey];
      const current = decryptedCache[note.id];
      const updated = { ...current, comments: (current.comments || []).filter((c) => c.id !== commentId) };
      const cipher = await encryptJson(key, updated);
      const next = notes.map((n) => (n.id === note.id ? { ...n, cipher } : n));
      setNotes(next); persistNotes(next);
      setDecryptedCache((prev) => ({ ...prev, [note.id]: updated }));
    } else {
      const next = notes.map((n) => (n.id === note.id ? { ...n, comments: (n.comments || []).filter((c) => c.id !== commentId) } : n));
      setNotes(next); persistNotes(next);
    }
  }
  async function addImagesToNote(note, urls) {
    if (note.encrypted) {
      const entry = findProtectedAncestor(note.path);
      const key = unlockedKeys[entry.pathKey];
      const current = decryptedCache[note.id] || { text: "", listItemText: null, comments: [], images: [] };
      const updated = { ...current, images: [...(current.images || []), ...urls] };
      const cipher = await encryptJson(key, updated);
      const next = notes.map((n) => (n.id === note.id ? { ...n, cipher } : n));
      setNotes(next); persistNotes(next);
      setDecryptedCache((prev) => ({ ...prev, [note.id]: updated }));
    } else {
      const next = notes.map((n) => (n.id === note.id ? { ...n, images: [...(n.images || []), ...urls] } : n));
      setNotes(next); persistNotes(next);
    }
  }
  function triggerNoteImageInput(noteId) { setImageTargetNoteId(noteId); noteFileInputRef.current?.click(); }
  async function handleNoteFileChange(e) {
    const files = Array.from(e.target.files || []);
    if (files.length && imageTargetNoteId) {
      const urls = await Promise.all(files.map(readFileAsDataURL));
      const note = notes.find((n) => n.id === imageTargetNoteId);
      if (note) await addImagesToNote(note, urls);
    }
    e.target.value = ""; setImageTargetNoteId(null);
  }

  async function moveNoteToPath(note, newPath) {
    if (pathKeyOf(newPath) === pathKeyOf(note.path)) return;
    const cur = note.encrypted ? decryptedCache[note.id] : note;
    if (!cur) return; // kilitli not, taşınamaz
    const plain = { text: cur.text, listItemText: cur.listItemText || null, comments: cur.comments || [], images: cur.images || [] };
    const base = { id: note.id, path: newPath, isReminder: note.isReminder, reminderAt: note.reminderAt, reminderLabel: note.reminderLabel, isListItem: note.isListItem, checked: note.checked, createdAt: note.createdAt };
    const newProtEntry = findProtectedAncestor(newPath);
    let updatedNote;
    if (newProtEntry) {
      let key = unlockedKeys[newProtEntry.pathKey];
      if (!key) { const r = await requestPassword("unlock", newProtEntry.pathKey.split("/")); if (!r?.ok) return; key = r.key; }
      const cipher = await encryptJson(key, plain);
      updatedNote = { ...base, encrypted: true, cipher };
      setDecryptedCache((prev) => ({ ...prev, [note.id]: plain }));
    } else {
      updatedNote = { ...base, encrypted: false, ...plain };
      if (note.encrypted) setDecryptedCache((prev) => { const n = { ...prev }; delete n[note.id]; return n; });
    }
    const next = notes.map((n) => (n.id === note.id ? updatedNote : n));
    setNotes(next); persistNotes(next);
  }

  async function onDropNoteOnPath(noteId, targetPath) {
    const note = notes.find((n) => n.id === noteId);
    if (!note) return;
    if (note.encrypted && !decryptedCache[note.id]) return; // kilitli not sürüklenemez
    await moveNoteToPath(note, targetPath);
  }

  function togglePanel(noteId, type) {
    setPanelState((prev) => {
      const cur = prev[noteId];
      if (cur && cur.type === type) { const n = { ...prev }; delete n[noteId]; return n; }
      return { ...prev, [noteId]: { type, instruction: "", loading: false, result: "", error: "", pasted: "", commentDraft: "" } };
    });
  }
  function updatePanel(noteId, patch) { setPanelState((prev) => ({ ...prev, [noteId]: { ...(prev[noteId] || {}), ...patch } })); }
  function closePanel(noteId) { setPanelState((prev) => { const n = { ...prev }; delete n[noteId]; return n; }); }

  async function handleAiSearch() {
    const qv = query.trim();
    if (!qv || notes.length === 0) return;
    setAiSearchLoading(true); setAiSearchError("");
    try {
      const searchable = notes.filter((n) => !n.encrypted || decryptedCache[n.id]);
      if (searchable.length === 0) { setAiMatchIds([]); return; }
      const system = `Kullanıcının kişisel notları arasında anlamsal arama yapıyorsun. Sorguya anlam olarak en uygun notların id'lerini en alakalıdan en az alakalıya sırala.
SADECE ham JSON döndür: {"ids": [string, ...]}.`;
      const notesList = searchable.map((n) => `- id: ${n.id} | yol: ${n.path.join(" / ")} | metin: ${getContent(n).text}`).join("\n");
      const result = await callClaudeJson(system, `Notlar:\n${notesList}\n\nSorgu: "${qv}"`);
      setAiMatchIds(Array.isArray(result.ids) ? result.ids : []);
    } catch (e) { console.error(e); setAiSearchError("Akıllı arama şu an çalışmadı."); } finally { setAiSearchLoading(false); }
  }
  function clearSearch() { setQuery(""); setAiMatchIds(null); setAiSearchError(""); }

  let scoped = selectedPath ? notes.filter((n) => pathStartsWith(n.path, selectedPath)) : notes;
  const qLower = query.trim().toLowerCase();
  let visibleNotes = scoped;
  if (aiMatchIds !== null) {
    const order = new Map(aiMatchIds.map((id, i) => [id, i]));
    visibleNotes = scoped.filter((n) => order.has(n.id)).sort((a, b) => order.get(a.id) - order.get(b.id));
  } else if (qLower) {
    visibleNotes = scoped.filter((n) => {
      const hay = (n.encrypted ? decryptedCache[n.id]?.text || "" : n.text) + " " + n.path.join(" / ");
      return hay.toLowerCase().includes(qLower);
    });
  }

  const reminders = notes.filter((n) => n.isReminder && n.reminderAt).sort((a, b) => new Date(a.reminderAt) - new Date(b.reminderAt));
  function formatDate(iso) { try { return new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return iso; } }
  function sourceLabel(s) { return s === "claude" ? "Claude" : s === "chatgpt" ? "ChatGPT" : "Sen"; }
  function sourceColor(s) { return s === "claude" ? COLORS.accent : s === "chatgpt" ? COLORS.reminder : COLORS.text; }

  return (
    <div style={{ background: COLORS.bg, minHeight: "100%", color: COLORS.text }}>
      <style>{`
        * { box-sizing: border-box; }
        .na-root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; }
        .na-textarea { width: 100%; resize: none; border: none; outline: none; background: transparent; font-size: 16px; line-height: 1.5; color: ${COLORS.text}; font-family: inherit; min-height: 56px; }
        .na-textarea::placeholder { color: ${COLORS.textMuted}; }
        .na-editable { white-space: pre-wrap; word-break: break-word; overflow-wrap: break-word; }
        .na-editable:empty:before { content: attr(data-placeholder); color: ${COLORS.textMuted}; pointer-events: none; }
        .na-editable img { max-width: 180px; max-height: 180px; border-radius: 5px; vertical-align: middle; margin: 2px 6px 2px 0; }
        .na-editable, .na-editable * {
          font-weight: normal !important; font-style: normal !important; text-decoration: none !important;
          color: ${COLORS.text} !important; font-size: 16px !important; font-family: inherit !important; background: transparent !important;
        }
        .na-bc-input { width: 100%; border: 1px dashed ${COLORS.border}; border-radius: 6px; padding: 7px 10px; font-size: 13px; font-family: inherit; outline: none; color: ${COLORS.text}; background: ${COLORS.surface}; }
        .na-bc-input:focus { border-style: solid; border-color: ${COLORS.accent}; }
        .na-btn { border: none; border-radius: 6px; padding: 7px 14px; font-size: 13px; font-weight: 500; cursor: pointer; font-family: inherit; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
        .na-btn-primary { background: ${COLORS.text}; color: #fff; }
        .na-btn-primary:disabled { opacity: 0.4; cursor: default; }
        .na-btn-ghost { background: transparent; color: ${COLORS.textMuted}; border: 1px solid ${COLORS.border}; }
        .na-chip { border: 1px solid ${COLORS.border}; border-radius: 999px; padding: 3px 10px; font-size: 12px; cursor: pointer; background: ${COLORS.surface}; color: ${COLORS.text}; }
        .na-chip:hover { border-color: ${COLORS.accent}; color: ${COLORS.accent}; }
        .na-search-input { border: 1px solid ${COLORS.border}; border-radius: 6px; padding: 7px 10px 7px 32px; font-size: 13px; font-family: inherit; outline: none; width: 100%; background: ${COLORS.surface}; color: ${COLORS.text}; }
        .na-search-input:focus { border-color: ${COLORS.accent}; }
        .na-row:hover .na-action { opacity: 1; }
        .na-action { opacity: 0; transition: opacity 0.15s; cursor: pointer; background: none; border: none; color: ${COLORS.textMuted}; padding: 2px; display: flex; }
        .na-action:hover { color: ${COLORS.accent}; }
        .na-spin { animation: na-spin 0.8s linear infinite; }
        @keyframes na-spin { to { transform: rotate(360deg); } }
        .na-layout { display: flex; gap: 20px; align-items: flex-start; }
        @media (max-width: 680px) { .na-layout { flex-direction: column; } .na-sidebar { width: 100% !important; } }
        .na-checkbox { width: 16px; height: 16px; border-radius: 4px; border: 1.5px solid ${COLORS.border}; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; margin-top: 2px; }
      `}</style>

      <PasswordModal state={pwdModal} onConfirm={handlePwdConfirm} onCancel={handlePwdCancel} />
      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      <input ref={noteFileInputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handleNoteFileChange} />

      <div className="na-root" style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px 300px" }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 24 }}>Notlar</div>

        {reminders.length > 0 && (
          <div style={{ background: COLORS.reminderSoft, border: `1px solid ${COLORS.reminder}22`, borderRadius: 8, padding: "10px 14px", marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.reminder, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}><Clock size={13} /> Hatırlatmalar</div>
            {reminders.map((r) => (
              <div key={r.id} style={{ fontSize: 13, padding: "3px 0" }}>
                <span style={{ color: COLORS.reminder, fontWeight: 500 }}>{formatDate(r.reminderAt)}</span> — {r.reminderLabel || (r.encrypted ? "(kilitli not)" : r.text)}
              </div>
            ))}
          </div>
        )}

        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: COLORS.textMuted }} />
              <input className="na-search-input" placeholder="Notlarda ara..." value={query} onChange={(e) => { setQuery(e.target.value); setAiMatchIds(null); }} onKeyDown={(e) => e.key === "Enter" && handleAiSearch()} />
            </div>
            <button className="na-btn na-btn-ghost" onClick={handleAiSearch} disabled={aiSearchLoading || !query.trim()}>{aiSearchLoading ? <Loader2 size={13} className="na-spin" /> : <Sparkles size={13} />} AI ara</button>
            {(query || aiMatchIds !== null) && <button className="na-btn na-btn-ghost" onClick={clearSearch}><X size={13} /></button>}
          </div>
          {aiSearchError && <div style={{ fontSize: 12, color: COLORS.danger, marginTop: 6 }}>{aiSearchError}</div>}
          {aiMatchIds !== null && !aiSearchError && <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 6 }}>{aiMatchIds.length} eşleşme</div>}
        </div>

        <div className="na-layout">
          <div className="na-sidebar" style={{ width: 220, flexShrink: 0, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 8, maxHeight: 520, overflowY: "auto" }}>
            <div onClick={() => setSelectedPath(null)} style={{ padding: "5px 8px", borderRadius: 5, cursor: "pointer", fontSize: 13, fontWeight: 600, marginBottom: 4, background: !selectedPath ? COLORS.accentSoft : "transparent", color: !selectedPath ? COLORS.accent : COLORS.text }}>Tümü</div>
            {Object.keys(tree.children).length === 0 ? (
              <div style={{ fontSize: 12, color: COLORS.textMuted, padding: "6px 8px" }}>Henüz kategori yok</div>
            ) : (
              Object.keys(tree.children).map((k) => <TreeNode key={k} name={k} node={tree.children[k]} depth={0} pathSoFar={[k]} selectedPath={selectedPath} onSelect={setSelectedPath} protectedFolders={protectedFolders} unlockedKeys={unlockedKeys} onLockClick={onLockClick} onDropNote={onDropNoteOnPath} />)
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            {selectedPath && (
              <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 10, marginBottom: 14 }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  <input className="na-bc-input" style={{ borderStyle: "solid", flex: 1 }} value={quickAddPath} onChange={(e) => setQuickAddPath(e.target.value)} placeholder="Kategori / Klasör / Sayfa" />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="na-bc-input"
                    style={{ borderStyle: "solid", flex: 1 }}
                    placeholder="Buraya doğrudan not ekle..."
                    value={quickAddText}
                    onChange={(e) => setQuickAddText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleQuickAdd()}
                  />
                  <button className="na-btn na-btn-primary" onClick={handleQuickAdd} disabled={!quickAddText.trim()}><Plus size={14} /> Ekle</button>
                </div>
                {quickAddError && <div style={{ fontSize: 12, color: COLORS.danger, marginTop: 6 }}>{quickAddError}</div>}
              </div>
            )}
            <div style={{ maxHeight: 520, overflowY: "auto", paddingRight: 4 }}>
            {!loaded ? (
              <div style={{ fontSize: 13, color: COLORS.textMuted }}>Yükleniyor...</div>
            ) : visibleNotes.length === 0 ? (
              <div style={{ fontSize: 13, color: COLORS.textMuted, padding: "20px 0" }}>Bu görünümde not yok.</div>
            ) : (
              visibleNotes.map((n) => {
                const locked = n.encrypted && !decryptedCache[n.id];
                const content = getContent(n);
                const panel = panelState[n.id];
                const isExpanded = expandedIds.has(n.id);
                return (
                  <div
                    key={n.id}
                    draggable={!locked && editingId !== n.id}
                    onDragStart={(e) => { e.dataTransfer.setData("text/plain", n.id); e.dataTransfer.effectAllowed = "move"; }}
                    style={
                      isExpanded
                        ? { position: "relative", background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "22px 26px", margin: "10px 0", boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }
                        : { position: "relative", borderBottom: `1px solid ${COLORS.border}`, padding: "10px 0", cursor: !locked && editingId !== n.id ? "grab" : "default" }
                    }
                  >
                    <div className="na-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                      {locked ? (
                        <div onClick={() => onLockClick((findProtectedAncestor(n.path)?.pathKey || pathKeyOf(n.path)).split("/"))} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: COLORS.textMuted, padding: "2px 0" }}>
                          <Lock size={13} /> Kilitli not — görmek için tıkla
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 8, flex: 1, minWidth: 0 }}>
                          {n.isListItem && (
                            <div className="na-checkbox" onClick={() => toggleChecked(n)} style={{ background: n.checked ? COLORS.ok : "transparent", borderColor: n.checked ? COLORS.ok : COLORS.border }}>
                              {n.checked && <Check size={11} color="#fff" />}
                            </div>
                          )}
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div
                              onClick={(e) => { e.stopPropagation(); setSelectedPath(n.path); }}
                              style={{ fontSize: 11, color: COLORS.accent, marginBottom: 3, cursor: "pointer", display: "inline-flex", alignItems: "center", width: "fit-content" }}
                              title={n.path.join(" / ")}
                              onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                              onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                            >
                              {n.path[n.path.length - 1]}{n.encrypted && <Lock size={9} style={{ display: "inline", marginLeft: 5 }} />}
                            </div>
                            {editingId === n.id ? (
                              <div style={{ marginTop: 2 }}>
                                <textarea
                                  className="na-textarea"
                                  style={{ border: `1px solid ${COLORS.accent}`, borderRadius: 6, padding: 10, fontSize: 14, minHeight: 120, width: "100%", resize: "vertical", background: COLORS.surface }}
                                  value={editDraft}
                                  onChange={(e) => setEditDraft(e.target.value)}
                                  autoFocus
                                />
                                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                                  <button className="na-btn na-btn-primary" onClick={() => saveEdit(n)}>Kaydet</button>
                                  <button className="na-btn na-btn-ghost" onClick={cancelEdit}>Vazgeç</button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ fontSize: isExpanded ? 17 : 14, lineHeight: isExpanded ? 1.75 : 1.5, textDecoration: n.checked ? "line-through" : "none", color: n.checked ? COLORS.textMuted : COLORS.text }}>
                                {n.isListItem ? (
                                  content.listItemText || content.text
                                ) : content.blocks?.length > 0 ? (
                                  content.blocks.map((b, i) =>
                                    b.type === "image" ? (
                                      <img key={i} src={b.src} onClick={() => setLightboxSrc(b.src)} style={{ maxWidth: isExpanded ? 340 : 160, maxHeight: isExpanded ? 340 : 160, borderRadius: 5, cursor: "zoom-in", verticalAlign: "middle", margin: "4px 8px 4px 0", border: `1px solid ${COLORS.border}` }} />
                                    ) : (
                                      <span key={i} style={{ whiteSpace: "pre-wrap" }}>{b.content}</span>
                                    )
                                  )
                                ) : (
                                  content.text
                                )}
                              </div>
                            )}
                            <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 4 }}>
                              {formatDate(n.createdAt)}
                              {n.isReminder && <span style={{ color: COLORS.reminder, marginLeft: 8 }}><Clock size={10} style={{ display: "inline", marginRight: 2 }} /> hatırlatma</span>}
                            </div>

                            {!content.blocks?.length && content.images?.length > 0 && (
                              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                                {content.images.map((src, i) => <img key={i} src={src} onClick={() => setLightboxSrc(src)} style={{ width: isExpanded ? 140 : 64, height: isExpanded ? 140 : 64, objectFit: "cover", borderRadius: 5, cursor: "zoom-in", border: `1px solid ${COLORS.border}` }} />)}
                              </div>
                            )}

                            {content.comments?.length > 0 && (
                              <div style={{ marginTop: 8, paddingLeft: 10, borderLeft: `2px solid ${COLORS.border}` }}>
                                {content.comments.map((c) => (
                                  <div key={c.id} style={{ fontSize: 12, color: COLORS.textMuted, padding: "3px 0", display: "flex", justifyContent: "space-between", gap: 8 }}>
                                    <div>
                                      <span style={{ fontWeight: 600, color: sourceColor(c.source) }}>{sourceLabel(c.source)}</span>
                                      <span style={{ fontSize: 10, marginLeft: 6 }}>{formatDate(c.createdAt)}</span>
                                      <div style={{ whiteSpace: "pre-wrap" }}>{c.text}</div>
                                    </div>
                                    <button onClick={() => deleteComment(n, c.id)} style={{ background: "none", border: "none", cursor: "pointer", color: COLORS.textMuted, flexShrink: 0 }}><X size={11} /></button>
                                  </div>
                                ))}
                              </div>
                            )}

                            {panel?.type === "comment" && (
                              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                                <input className="na-bc-input" style={{ borderStyle: "solid" }} placeholder="Yorumunu yaz..." value={panel.commentDraft || ""} onChange={(e) => updatePanel(n.id, { commentDraft: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addComment(n, panel.commentDraft, "user")} autoFocus />
                                <button className="na-btn na-btn-primary" onClick={() => addComment(n, panel.commentDraft, "user")}>Ekle</button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      {!locked && editingId !== n.id && (
                        <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                          <button
                            className={isExpanded ? undefined : "na-action"}
                            title={isExpanded ? "Okuma modundan çık" : "Okuma moduna geç"}
                            onClick={() => toggleExpand(n.id)}
                            style={isExpanded ? { background: "none", border: "none", cursor: "pointer", color: COLORS.accent, padding: 2, display: "flex" } : undefined}
                          >
                            {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                          </button>
                          <button className="na-action" title="Düzenle" onClick={() => startEdit(n)}><Pencil size={14} /></button>
                          <button className="na-action" title="Yorum ekle" onClick={() => togglePanel(n.id, "comment")}><MessageCircle size={14} /></button>
                          <button className="na-action" title="Görsel ekle" onClick={() => triggerNoteImageInput(n.id)}><ImagePlus size={14} /></button>
                          <button className="na-action" title="Sil" onClick={() => handleDelete(n.id)}><X size={14} /></button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            </div>
          </div>
        </div>
      </div>

      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: COLORS.bg, borderTop: `1px solid ${COLORS.border}`, padding: "12px 20px", zIndex: 30 }}>
        <div className="na-root" style={{ maxWidth: 900, margin: "0 auto", padding: 0 }}>
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "14px 16px", boxShadow: "0 -2px 12px rgba(0,0,0,0.05)" }}>
            <div
              ref={composerEditableRef}
              className="na-textarea na-editable"
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              data-gramm="false"
              data-gramm_editor="false"
              data-enable-grammarly="false"
              data-placeholder="Aklına geleni yaz... (görsel yapıştırabilirsin veya sürükleyebilirsin)"
              onInput={syncComposerPlainText}
              onPaste={handleComposerPaste}
              onDrop={handleComposerDrop}
              onDragOver={(e) => e.preventDefault()}
            />

            <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
              <input className="na-bc-input" placeholder="Kategori / Klasör / Sayfa" value={breadcrumb} onChange={(e) => { setBreadcrumb(e.target.value); setAutoMode(false); }} />
              <input ref={composerFileInputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handleComposerFiles} />
              <button className="na-btn na-btn-ghost" onClick={() => composerFileInputRef.current?.click()} title="Görsel ekle"><ImagePlus size={13} /></button>
              {autoMode ? (
                <button className="na-btn na-btn-ghost" onClick={() => setAutoMode(false)}>Elle gireceğim</button>
              ) : (
                <button className="na-btn na-btn-ghost" onClick={() => { setAutoMode(true); if (input.trim().length >= 6) runSuggest(input.trim()); }}><Sparkles size={13} /> AI'ya bırak</button>
              )}
              <button className="na-btn na-btn-primary" onClick={handleSave} disabled={composerEmpty || !breadcrumb.trim()}><Plus size={14} /> Ekle</button>
            </div>

            <div style={{ minHeight: 14, marginTop: 6 }}>
              {autoMode && suggestLoading && <div style={{ fontSize: 11, color: COLORS.textMuted, display: "flex", alignItems: "center", gap: 5 }}><Loader2 size={11} className="na-spin" /> AI kategori öneriyor...</div>}
            </div>

            {suggestion && (
              <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, color: suggestion.confident ? COLORS.ok : COLORS.warn, background: suggestion.confident ? COLORS.okSoft : COLORS.warnSoft }}>
                    {suggestion.confident ? "AI emin" : "AI emin değil — kontrol et"}
                  </span>
                  {suggestion.isListItem && <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, color: COLORS.accent, background: COLORS.accentSoft }}>liste öğesi: {suggestion.listItemText}</span>}
                  {suggestion.reason && <span style={{ fontSize: 12, color: COLORS.textMuted }}>{suggestion.reason}</span>}
                </div>
                {!suggestion.confident && suggestion.alternatives?.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {suggestion.alternatives.map((alt, i) => <button key={i} className="na-chip" onClick={() => applyAlternative(alt)}>{alt.join(" / ")}</button>)}
                  </div>
                )}
              </div>
            )}
            {saveError && <div style={{ fontSize: 12, color: COLORS.danger, marginTop: 8 }}>{saveError}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
