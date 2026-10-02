const CONFIG_KEYS = [
  "nightstand.v1",
  "narrivox.interface.v1",
  "narrivox.storage.v1",
  "nightstand-public-books",
] as const;

const CHUNK = 128 * 1024;

type VaultBridge = {
  readText: (name: string) => string;
  writeText: (name: string, json: string) => boolean;
  hasAudio: (bookId: string, chapterId: string) => boolean;
  audioSize: (bookId: string, chapterId: string) => string;
  writeChunk: (bookId: string, chapterId: string, offset: number, base64: string) => boolean;
  readChunk: (bookId: string, chapterId: string, offset: number, length: number) => string;
  deleteBook: (bookId: string) => boolean;
  listAudio: () => string;
};

export type VaultAudio = {
  bookId: string;
  chapterId: string;
  size: number;
};

function bridge(): VaultBridge | null {
  if (typeof window === "undefined") return null;
  const native = (window as unknown as { NarrivoxVault?: Partial<VaultBridge> }).NarrivoxVault;
  if (!native?.readText || !native.writeText || !native.writeChunk || !native.readChunk || !native.listAudio) {
    return null;
  }
  return native as VaultBridge;
}

export function vaultAvailable() {
  return bridge() !== null;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const step = 0x2000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
}

function bytesFromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function persistConfig() {
  const native = bridge();
  if (!native || typeof localStorage === "undefined") return;
  const saved: Record<string, string> = {};
  for (const key of CONFIG_KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null) saved[key] = value;
  }
  try {
    native.writeText("config", JSON.stringify(saved));
  } catch {
    // The vault is an Android extra. The WebView copy still stands.
  }
}

export function restoreConfig() {
  const native = bridge();
  if (!native || typeof localStorage === "undefined") return;
  let saved: Record<string, unknown> = {};
  try {
    const raw = native.readText("config");
    if (raw) saved = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    saved = {};
  }
  for (const key of CONFIG_KEYS) {
    if (localStorage.getItem(key) !== null) continue;
    const value = saved[key];
    if (typeof value === "string") localStorage.setItem(key, value);
  }
  persistConfig();
}

export function readVaultBooks(): unknown[] | null {
  const native = bridge();
  if (!native) return null;
  try {
    const raw = native.readText("books");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeVaultBooks(books: unknown[]) {
  const native = bridge();
  if (!native) return;
  try {
    native.writeText("books", JSON.stringify(books));
  } catch {
    // Ignore a vault write failure. The caller still has the WebView copy.
  }
}

export function vaultDeleteBook(bookId: string) {
  const native = bridge();
  if (!native) return;
  try {
    native.deleteBook(bookId);
  } catch {
    // Same as a missed config write: keep going.
  }
}

export function vaultListAudio(): VaultAudio[] {
  const native = bridge();
  if (!native) return [];
  try {
    const parsed = JSON.parse(native.listAudio() || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    const files: VaultAudio[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const row = item as { bookId?: unknown; chapterId?: unknown; size?: unknown };
      if (typeof row.bookId !== "string" || typeof row.chapterId !== "string") continue;
      const size = typeof row.size === "number" ? row.size : Number(row.size);
      if (!Number.isFinite(size) || size <= 0) continue;
      files.push({ bookId: row.bookId, chapterId: row.chapterId, size });
    }
    return files;
  } catch {
    return [];
  }
}

export async function vaultWriteBlob(bookId: string, chapterId: string, blob: Blob) {
  const native = bridge();
  if (!native || blob.size === 0) return;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    const slice = bytes.subarray(offset, Math.min(bytes.length, offset + CHUNK));
    if (!native.writeChunk(bookId, chapterId, offset, bytesToBase64(slice))) {
      throw new Error("The on-device library couldn't store that chapter.");
    }
  }
}

export async function vaultReadBlob(bookId: string, chapterId: string): Promise<Blob | null> {
  const native = bridge();
  if (!native || !native.hasAudio(bookId, chapterId)) return null;
  const size = Number(native.audioSize(bookId, chapterId));
  if (!Number.isFinite(size) || size <= 0) return null;
  const parts: BlobPart[] = [];
  for (let offset = 0; offset < size; offset += CHUNK) {
    const encoded = native.readChunk(bookId, chapterId, offset, Math.min(CHUNK, size - offset));
    if (!encoded) return null;
    parts.push(bytesFromBase64(encoded));
  }
  return new Blob(parts);
}
