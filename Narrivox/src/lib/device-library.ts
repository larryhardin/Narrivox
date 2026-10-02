import type { UserBook } from "@/lib/types";

const CHUNK = 128 * 1024;

type Bridge = {
  usingFolder: () => boolean;
  locationLabel: () => string;
  pendingLabel: () => string;
  pickFolder: () => void;
  commitFolder: () => boolean;
  discardFolder: () => void;
  readManifest: (staged: boolean) => string;
  writeManifest: (staged: boolean, json: string) => boolean;
  listAudio: (staged: boolean) => string;
  writeChunk: (staged: boolean, bookId: string, chapterId: string, offset: number, base64: string) => boolean;
  readChunk: (staged: boolean, bookId: string, chapterId: string, offset: number, length: number) => string;
  deleteBook: (staged: boolean, bookId: string) => boolean;
};

export type DeviceAudio = { bookId: string; chapterId: string; size: number };

function bridge(): Bridge | null {
  if (typeof window === "undefined") return null;
  const native = (window as unknown as { NarrivoxLibrary?: Partial<Bridge> }).NarrivoxLibrary;
  if (!native?.pickFolder || !native.writeChunk || !native.readChunk || !native.commitFolder) return null;
  return native as Bridge;
}

export function deviceLibraryAvailable() {
  return bridge() !== null;
}

export function deviceUsingFolder() {
  const native = bridge();
  if (!native) return false;
  try {
    return native.usingFolder();
  } catch {
    return false;
  }
}

export function deviceLocationLabel() {
  const native = bridge();
  if (!native) return "App storage";
  try {
    const label = native.locationLabel();
    return label || "App storage";
  } catch {
    return "App storage";
  }
}

export function pickDeviceFolder(): Promise<"ok" | "same" | "cancel"> {
  const native = bridge();
  if (!native) return Promise.resolve("cancel");
  return new Promise((resolve) => {
    const target = window as unknown as { __narrivoxLibraryPicked?: (result: string) => void };
    target.__narrivoxLibraryPicked = (result) => {
      delete target.__narrivoxLibraryPicked;
      if (result === "ok" || result === "same") resolve(result);
      else resolve("cancel");
    };
    try {
      native.pickFolder();
    } catch {
      delete target.__narrivoxLibraryPicked;
      resolve("cancel");
    }
  });
}

export function devicePendingLabel() {
  const native = bridge();
  if (!native) return "";
  try {
    return native.pendingLabel() || "";
  } catch {
    return "";
  }
}

export function commitDeviceFolder() {
  bridge()?.commitFolder();
}

export function discardDeviceFolder() {
  try {
    bridge()?.discardFolder();
  } catch {
    // The picker was already dismissed.
  }
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

export function deviceReadBooks(staged: boolean): UserBook[] {
  const native = bridge();
  if (!native) return [];
  try {
    const raw = native.readManifest(staged);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { books?: unknown };
    if (!Array.isArray(parsed.books)) return [];
    return parsed.books.filter(isBook);
  } catch {
    return [];
  }
}

export function deviceWriteBooks(staged: boolean, books: UserBook[]) {
  const native = bridge();
  if (!native) throw new Error("That folder couldn't be written.");
  if (!native.writeManifest(staged, JSON.stringify({ books }))) {
    throw new Error("That folder couldn't be written.");
  }
}

export function deviceDeleteBook(staged: boolean, bookId: string) {
  bridge()?.deleteBook(staged, bookId);
}

export function deviceListAudio(staged: boolean): DeviceAudio[] {
  const native = bridge();
  if (!native) return [];
  try {
    const parsed = JSON.parse(native.listAudio(staged) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    const files: DeviceAudio[] = [];
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

export async function deviceWriteBlob(staged: boolean, bookId: string, chapterId: string, blob: Blob) {
  const native = bridge();
  if (!native) throw new Error("That folder couldn't be written.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length === 0) return;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    const slice = bytes.subarray(offset, Math.min(bytes.length, offset + CHUNK));
    if (!native.writeChunk(staged, bookId, chapterId, offset, bytesToBase64(slice))) {
      throw new Error("That folder couldn't store this chapter.");
    }
  }
}

export async function deviceReadBlob(staged: boolean, bookId: string, chapterId: string): Promise<Blob | null> {
  const native = bridge();
  if (!native) return null;
  const known = deviceListAudio(staged).find((file) => file.bookId === bookId && file.chapterId === chapterId);
  if (!known) return null;
  const parts: BlobPart[] = [];
  for (let offset = 0; offset < known.size; offset += CHUNK) {
    const encoded = native.readChunk(staged, bookId, chapterId, offset, Math.min(CHUNK, known.size - offset));
    if (!encoded) return null;
    parts.push(bytesFromBase64(encoded));
  }
  return new Blob(parts);
}

function isBook(value: unknown): value is UserBook {
  if (!value || typeof value !== "object") return false;
  const book = value as UserBook;
  return (
    typeof book.id === "string" &&
    typeof book.title === "string" &&
    typeof book.author === "string" &&
    typeof book.createdAt === "number" &&
    Array.isArray(book.chapters)
  );
}
