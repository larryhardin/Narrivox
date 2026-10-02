import { getAudio } from "@/lib/audio-bus";
import {
  commitDeviceFolder,
  deviceDeleteBook,
  deviceLibraryAvailable,
  deviceListAudio,
  deviceLocationLabel,
  devicePendingLabel,
  deviceReadBlob,
  deviceReadBooks,
  deviceUsingFolder,
  deviceWriteBlob,
  deviceWriteBooks,
  discardDeviceFolder,
  pickDeviceFolder,
} from "@/lib/device-library";

export { discardDeviceFolder };
import {
  persistConfig,
  readVaultBooks,
  restoreConfig,
  vaultDeleteBook,
  vaultListAudio,
  vaultReadBlob,
  vaultWriteBlob,
  writeVaultBooks,
} from "@/lib/app-vault";
import {
  clearFolderLibrary,
  deleteFolderAudio,
  listFolderAudio,
  listFolderBooks,
  readFolderAudio,
  writeFolderAudio,
  writeFolderBooks,
} from "@/lib/folder-library";
import type { UserBook } from "@/lib/types";

const DB_NAME = "nightstand";
const DB_VERSION = 2;
const PREF_KEY = "narrivox.storage.v1";
const HANDLE_KEY = "library-dir";

const urls = new Map<string, string>();

type Location =
  | { kind: "browser" }
  | { kind: "folder"; handle: FileSystemDirectoryHandle; name: string }
  | { kind: "device"; name: string; staged: boolean };

export type StorageTarget =
  | { kind: "browser" }
  | { kind: "folder"; handle: FileSystemDirectoryHandle }
  | { kind: "device"; name: string; staged: boolean };

export type StorageStatus = {
  kind: "browser" | "folder" | "device";
  label: string;
  permission: "granted" | "prompt" | "denied" | "missing";
  canPickFolder: boolean;
  lostFolder: string | null;
  books: number;
  files: number;
  bytes: number;
};

export type CommitResult = { moved: boolean; leftover: boolean };

let resolved: Location | null = null;
let lostFolder: string | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("books")) {
        db.createObjectStore("books", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("audio")) {
        db.createObjectStore("audio");
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function audioKey(bookId: string, chapterId: string) {
  return `${bookId}:${chapterId}`;
}

function splitAudioKey(key: string): { bookId: string; chapterId: string } | null {
  const index = key.indexOf(":");
  if (index <= 0 || index === key.length - 1) return null;
  return { bookId: key.slice(0, index), chapterId: key.slice(index + 1) };
}

function isDirectoryHandle(value: unknown): value is FileSystemDirectoryHandle {
  if (!value || typeof value !== "object") return false;
  const handle = value as FileSystemDirectoryHandle;
  return handle.kind === "directory" && typeof handle.getFileHandle === "function";
}

function readPref(): { kind: "browser" } | { kind: "folder"; name: string } {
  if (typeof localStorage === "undefined") return { kind: "browser" };
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) ?? "") as { kind?: string; name?: string };
    if (raw?.kind === "folder" && typeof raw.name === "string" && raw.name) {
      return { kind: "folder", name: raw.name };
    }
  } catch {
    /* use the browser store */
  }
  return { kind: "browser" };
}

function writePref(pref: { kind: "browser" } | { kind: "folder"; name: string }) {
  localStorage.setItem(PREF_KEY, JSON.stringify(pref));
  persistConfig();
}

async function idbGetMeta(key: string): Promise<unknown> {
  const db = await openDb();
  try {
    const tx = db.transaction("meta", "readonly");
    const value = await requestToPromise(tx.objectStore("meta").get(key));
    await transactionDone(tx);
    return value;
  } finally {
    db.close();
  }
}

async function idbSetMeta(key: string, value: unknown) {
  const db = await openDb();
  try {
    const tx = db.transaction("meta", "readwrite");
    tx.objectStore("meta").put(value, key);
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

async function idbDeleteMeta(key: string) {
  const db = await openDb();
  try {
    const tx = db.transaction("meta", "readwrite");
    tx.objectStore("meta").delete(key);
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

async function idbListUserBooks(): Promise<UserBook[]> {
  const db = await openDb();
  try {
    const tx = db.transaction("books", "readonly");
    const all = await requestToPromise(tx.objectStore("books").getAll() as IDBRequest<UserBook[]>);
    await transactionDone(tx);
    return all.sort((a, b) => b.createdAt - a.createdAt);
  } finally {
    db.close();
  }
}

async function idbPutBook(book: UserBook) {
  const db = await openDb();
  try {
    const tx = db.transaction("books", "readwrite");
    tx.objectStore("books").put(book);
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

async function idbSaveUserBook(book: UserBook, files: { id: string; file: Blob }[]) {
  const db = await openDb();
  try {
    const tx = db.transaction(["books", "audio"], "readwrite");
    tx.objectStore("books").put(book);
    for (const file of files) {
      tx.objectStore("audio").put(file.file, audioKey(book.id, file.id));
    }
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

async function idbDeleteUserBook(book: UserBook) {
  const db = await openDb();
  try {
    const tx = db.transaction(["books", "audio"], "readwrite");
    tx.objectStore("books").delete(book.id);
    for (const chapter of book.chapters) {
      tx.objectStore("audio").delete(audioKey(book.id, chapter.id));
    }
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

async function idbClearBooksAndAudio() {
  const db = await openDb();
  try {
    const tx = db.transaction(["books", "audio"], "readwrite");
    tx.objectStore("books").clear();
    tx.objectStore("audio").clear();
    await transactionDone(tx);
  } finally {
    db.close();
  }
  clearVaultLibrary();
}

async function browserAudioFiles() {
  const found = new Map<string, { bookId: string; chapterId: string; bytes: number }>();
  for (const key of await idbAudioKeys()) {
    const parsed = splitAudioKey(key);
    if (!parsed) continue;
    const blob = await idbReadAudio(parsed.bookId, parsed.chapterId);
    if (!blob) continue;
    found.set(key, { ...parsed, bytes: blob.size });
  }
  for (const file of vaultListAudio()) {
    const key = audioKey(file.bookId, file.chapterId);
    if (!found.has(key)) found.set(key, { bookId: file.bookId, chapterId: file.chapterId, bytes: file.size });
  }
  return [...found.values()];
}

async function idbAudioKeys(): Promise<string[]> {
  const db = await openDb();
  try {
    const tx = db.transaction("audio", "readonly");
    const keys = await requestToPromise(tx.objectStore("audio").getAllKeys());
    await transactionDone(tx);
    return keys.filter((key): key is string => typeof key === "string");
  } finally {
    db.close();
  }
}

async function idbReadAudio(bookId: string, chapterId: string): Promise<Blob | null> {
  const db = await openDb();
  try {
    const tx = db.transaction("audio", "readonly");
    const blob = await requestToPromise(tx.objectStore("audio").get(audioKey(bookId, chapterId)));
    await transactionDone(tx);
    if (!(blob instanceof Blob) || blob.size === 0) return null;
    return blob;
  } finally {
    db.close();
  }
}

async function idbPutAudio(bookId: string, chapterId: string, blob: Blob) {
  const db = await openDb();
  try {
    const tx = db.transaction("audio", "readwrite");
    tx.objectStore("audio").put(blob, audioKey(bookId, chapterId));
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

async function permissionOf(
  handle: FileSystemDirectoryHandle,
): Promise<"granted" | "prompt" | "denied"> {
  if (typeof handle.queryPermission !== "function") return "granted";
  const state = await handle.queryPermission({ mode: "readwrite" });
  if (state === "granted" || state === "denied") return state;
  return "prompt";
}

async function ensureLocation(): Promise<Location> {
  if (deviceUsingFolder()) {
    const name = deviceLocationLabel();
    if (resolved?.kind === "device" && !resolved.staged && resolved.name === name) return resolved;
    resolved = { kind: "device", name, staged: false };
    lostFolder = null;
    return resolved;
  }
  if (resolved?.kind === "device") resolved = null;
  if (resolved) return resolved;
  const pref = readPref();
  if (pref.kind === "browser") {
    resolved = { kind: "browser" };
    return resolved;
  }
  const stored = await idbGetMeta(HANDLE_KEY);
  if (!isDirectoryHandle(stored)) {
    lostFolder = pref.name;
    writePref({ kind: "browser" });
    resolved = { kind: "browser" };
    return resolved;
  }
  resolved = { kind: "folder", handle: stored, name: stored.name || pref.name };
  return resolved;
}

async function listBooks(loc: Location): Promise<UserBook[]> {
  if (loc.kind === "browser") return idbListUserBooks();
  if (loc.kind === "device") return deviceReadBooks(loc.staged);
  if ((await permissionOf(loc.handle)) !== "granted") return [];
  return listFolderBooks(loc.handle);
}

async function listAudioRefs(loc: Location) {
  if (loc.kind === "browser") {
    return (await browserAudioFiles()).map(({ bookId, chapterId }) => ({ bookId, chapterId }));
  }
  if (loc.kind === "device") {
    return deviceListAudio(loc.staged).map(({ bookId, chapterId }) => ({ bookId, chapterId }));
  }
  if ((await permissionOf(loc.handle)) !== "granted") return [];
  return listFolderAudio(loc.handle);
}

async function audioIndex(loc: Location) {
  if (loc.kind === "browser") return browserAudioFiles();
  if (loc.kind === "device") {
    return deviceListAudio(loc.staged).map((file) => ({
      bookId: file.bookId,
      chapterId: file.chapterId,
      bytes: file.size,
    }));
  }
  if ((await permissionOf(loc.handle)) !== "granted") return [];
  return listFolderAudio(loc.handle);
}

async function readAudio(loc: Location, bookId: string, chapterId: string) {
  if (loc.kind === "browser") {
    return (await idbReadAudio(bookId, chapterId)) ?? (await vaultReadBlob(bookId, chapterId));
  }
  if (loc.kind === "device") return deviceReadBlob(loc.staged, bookId, chapterId);
  return readFolderAudio(loc.handle, bookId, chapterId);
}

async function writeAudio(loc: Location, bookId: string, chapterId: string, blob: Blob) {
  if (loc.kind === "browser") return idbPutAudio(bookId, chapterId, blob);
  if (loc.kind === "device") return deviceWriteBlob(loc.staged, bookId, chapterId, blob);
  return writeFolderAudio(loc.handle, bookId, chapterId, blob);
}

async function mergeBooks(loc: Location, books: UserBook[]) {
  if (books.length === 0) return;
  if (loc.kind === "browser") {
    const map = new Map((await idbListUserBooks()).map((book) => [book.id, book]));
    for (const book of books) map.set(book.id, book);
    for (const book of map.values()) await idbPutBook(book);
    return;
  }
  if (loc.kind === "device") {
    const map = new Map(deviceReadBooks(loc.staged).map((book) => [book.id, book]));
    for (const book of books) map.set(book.id, book);
    deviceWriteBooks(loc.staged, [...map.values()]);
    return;
  }
  const map = new Map((await listFolderBooks(loc.handle)).map((book) => [book.id, book]));
  for (const book of books) map.set(book.id, book);
  await writeFolderBooks(loc.handle, [...map.values()]);
}

async function clearLibrary(loc: Location) {
  if (loc.kind === "browser") {
    await idbClearBooksAndAudio();
    return;
  }
  if (loc.kind === "device") return;
  await clearFolderLibrary(loc.handle);
}

function asLocation(target: StorageTarget): Location {
  if (target.kind === "browser") return { kind: "browser" };
  if (target.kind === "device") return { kind: "device", name: target.name, staged: target.staged };
  return { kind: "folder", handle: target.handle, name: target.handle.name || "Folder" };
}

async function sameTarget(loc: Location, target: StorageTarget) {
  if (target.kind === "device") return loc.kind === "device" && !target.staged;
  if (loc.kind === "device") return false;
  if (loc.kind === "browser" || target.kind === "browser") {
    return loc.kind === target.kind;
  }
  if (typeof loc.handle.isSameEntry === "function") return loc.handle.isSameEntry(target.handle);
  return loc.name === target.handle.name;
}

async function persist(target: StorageTarget) {
  if (target.kind === "device") {
    commitDeviceFolder();
    writePref({ kind: "browser" });
    return;
  }
  discardDeviceFolder();
  if (target.kind === "browser") {
    writePref({ kind: "browser" });
    await idbDeleteMeta(HANDLE_KEY);
    return;
  }
  const name = target.handle.name || "Folder";
  writePref({ kind: "folder", name });
  await idbSetMeta(HANDLE_KEY, target.handle);
}

function releaseAudioCache() {
  const keep = getAudio()?.src ?? "";
  for (const [key, url] of urls) {
    if (url !== keep) URL.revokeObjectURL(url);
    urls.delete(key);
  }
}

async function requireWritable(): Promise<Location> {
  const loc = await ensureLocation();
  if (loc.kind === "folder" && (await permissionOf(loc.handle)) !== "granted") {
    throw new Error(`Allow access to “${loc.name}” in Settings before saving.`);
  }
  return loc;
}

export async function sameAsCurrent(target: StorageTarget) {
  return sameTarget(await ensureLocation(), target);
}

export function folderPickingSupported() {
  if (typeof window === "undefined" || typeof window.showDirectoryPicker !== "function") return false;
  try {
    return window.self === window.top;
  } catch {
    return false;
  }
}

export function friendlyStorageError(error: unknown): string | null {
  if (error instanceof DOMException && error.name === "AbortError") return null;
  if (
    error instanceof DOMException &&
    (error.name === "SecurityError" || error.name === "NotAllowedError")
  ) {
    return "This window can't choose a folder. Open Narrivox in its own browser tab and try again.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "That folder couldn't be used.";
}

export async function storageStatus(): Promise<StorageStatus> {
  const loc = await ensureLocation();
  const canPickFolder = folderPickingSupported();
  if (loc.kind === "browser") {
    const books = await idbListUserBooks();
    const files = await audioIndex(loc);
    return {
      kind: "browser" as const,
      label: deviceLibraryAvailable() ? "App storage" : "This browser",
      permission: "granted" as const,
      canPickFolder: deviceLibraryAvailable() || canPickFolder,
      lostFolder,
      books: books.length,
      files: files.length,
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    };
  }
  if (loc.kind === "device") {
    const books = await listBooks(loc);
    const files = await audioIndex(loc);
    return {
      kind: "device" as const,
      label: loc.name,
      permission: "granted" as const,
      canPickFolder: true,
      lostFolder: null,
      books: books.length,
      files: files.length,
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    };
  }
  const permission = await permissionOf(loc.handle);
  const books = permission === "granted" ? await listFolderBooks(loc.handle) : [];
  const files = permission === "granted" ? await listFolderAudio(loc.handle) : [];
  return {
    kind: "folder",
    label: loc.name,
    permission,
    canPickFolder,
    lostFolder: null,
    books: books.length,
    files: files.length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
  };
}

export async function chooseStorageLocation(): Promise<StorageTarget | "cancel" | "same"> {
  if (deviceLibraryAvailable()) {
    const picked = await pickDeviceFolder();
    if (picked !== "ok") return picked;
    return { kind: "device", name: devicePendingLabel() || "Chosen folder", staged: true };
  }
  const handle = await pickLibraryFolder();
  return { kind: "folder", handle };
}

export async function pickLibraryFolder() {
  if (!folderPickingSupported()) {
    throw new Error(
      "This browser can't choose a folder. Chrome or Edge can. Until then, books stay in this browser.",
    );
  }
  const handle = await window.showDirectoryPicker({
    id: "narrivox-audiobooks",
    mode: "readwrite",
    startIn: "music",
  });
  const perm = await handle.requestPermission({ mode: "readwrite" });
  if (perm !== "granted") throw new Error("Narrivox wasn't allowed to use that folder.");
  return handle;
}

export async function allowFolderAccess() {
  const loc = await ensureLocation();
  if (loc.kind !== "folder") return storageStatus();
  const perm = await loc.handle.requestPermission({ mode: "readwrite" });
  if (perm !== "granted") throw new Error(`Narrivox still doesn't have access to “${loc.name}”.`);
  return storageStatus();
}

export async function commitStorage(
  target: StorageTarget,
  move: boolean,
  onProgress?: (done: number, total: number) => void,
): Promise<CommitResult> {
  const from = await ensureLocation();
  if (await sameTarget(from, target)) return { moved: false, leftover: false };
  const next = asLocation(target);
  if (next.kind === "folder" && (await permissionOf(next.handle)) !== "granted") {
    throw new Error(`Narrivox can't write to “${next.name}”.`);
  }
  if (move) {
    if (from.kind === "folder" && (await permissionOf(from.handle)) !== "granted") {
      throw new Error(`Allow access to “${from.name}” before moving what is saved there.`);
    }
    const books = await listBooks(from);
    const index = await listAudioRefs(from);
    await mergeBooks(next, books);
    let done = 0;
    onProgress?.(0, index.length);
    for (const file of index) {
      const blob = await readAudio(from, file.bookId, file.chapterId);
      if (blob) await writeAudio(next, file.bookId, file.chapterId, blob);
      done += 1;
      onProgress?.(done, index.length);
    }
  }
  await persist(target);
  resolved = next.kind === "device" ? { kind: "device", name: deviceLocationLabel(), staged: false } : next;
  lostFolder = null;
  releaseAudioCache();
  if (!move) return { moved: false, leftover: false };
  if (from.kind === "device") return { moved: true, leftover: false };
  try {
    await clearLibrary(from);
    return { moved: true, leftover: false };
  } catch {
    return { moved: true, leftover: true };
  }
}

function isStoredBook(value: unknown): value is UserBook {
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

function clearVaultLibrary() {
  const ids = new Set<string>();
  for (const file of vaultListAudio()) ids.add(file.bookId);
  for (const book of readVaultBooks() ?? []) {
    if (isStoredBook(book)) ids.add(book.id);
  }
  for (const id of ids) vaultDeleteBook(id);
  writeVaultBooks([]);
}

async function rememberVaultChapter(bookId: string, chapterId: string, blob: Blob) {
  try {
    await vaultWriteBlob(bookId, chapterId, blob);
  } catch {
    // The WebView copy is already saved. The next launch copies it again.
  }
}

async function rememberVaultBook(book: UserBook, files: { id: string; file: Blob }[]) {
  writeVaultBooks(await idbListUserBooks());
  for (const file of files) await rememberVaultChapter(book.id, file.id, file.file);
}

let durable: Promise<void> | null = null;

export function prepareDurableLibrary() {
  if (!durable) {
    durable = restoreDurableLibrary().catch(() => undefined);
  }
  return durable;
}

async function restoreDurableLibrary() {
  restoreConfig();
  const saved = (readVaultBooks() ?? []).filter(isStoredBook);
  const local = await idbListUserBooks();
  const have = new Set(local.map((book) => book.id));
  for (const book of saved) {
    if (!have.has(book.id)) await idbPutBook(book);
  }
  writeVaultBooks(await idbListUserBooks());
  void mirrorBrowserAudio();
}

async function mirrorBrowserAudio() {
  const present = new Set(vaultListAudio().map((file) => audioKey(file.bookId, file.chapterId)));
  for (const key of await idbAudioKeys()) {
    if (present.has(key)) continue;
    const parsed = splitAudioKey(key);
    if (!parsed) continue;
    const blob = await idbReadAudio(parsed.bookId, parsed.chapterId);
    if (!blob) continue;
    await rememberVaultChapter(parsed.bookId, parsed.chapterId, blob);
  }
}

export async function listUserBooks(): Promise<UserBook[]> {
  await prepareDurableLibrary();
  const loc = await ensureLocation();
  const books = await listBooks(loc);
  return books.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveUserBook(book: UserBook, files: { id: string; file: Blob }[]) {
  const loc = await requireWritable();
  if (loc.kind === "browser") {
    await idbSaveUserBook(book, files);
    await rememberVaultBook(book, files);
    return;
  }
  if (loc.kind === "device") {
    const books = [book, ...deviceReadBooks(false).filter((item) => item.id !== book.id)];
    deviceWriteBooks(false, books);
    for (const file of files) await deviceWriteBlob(false, book.id, file.id, file.file);
    return;
  }
  const books = [book, ...(await listFolderBooks(loc.handle)).filter((item) => item.id !== book.id)];
  await writeFolderBooks(loc.handle, books);
  for (const file of files) await writeFolderAudio(loc.handle, book.id, file.id, file.file);
}

export async function deleteUserBook(book: UserBook) {
  const loc = await requireWritable();
  if (loc.kind === "browser") {
    await idbDeleteUserBook(book);
    vaultDeleteBook(book.id);
    writeVaultBooks(await idbListUserBooks());
  } else if (loc.kind === "device") {
    deviceWriteBooks(
      false,
      deviceReadBooks(false).filter((item) => item.id !== book.id),
    );
    deviceDeleteBook(false, book.id);
  } else {
    const books = (await listFolderBooks(loc.handle)).filter((item) => item.id !== book.id);
    await writeFolderBooks(loc.handle, books);
    for (const chapter of book.chapters) await deleteFolderAudio(loc.handle, book.id, chapter.id);
  }
  revokeBookAudio(book.id);
}

export function revokeBookAudio(bookId: string) {
  for (const [key, url] of urls) {
    if (key.startsWith(`${bookId}:`)) {
      URL.revokeObjectURL(url);
      urls.delete(key);
    }
  }
}

export function peekAudioUrl(bookId: string, chapterId: string) {
  return urls.get(audioKey(bookId, chapterId)) ?? null;
}

export async function getAudioUrl(bookId: string, chapterId: string): Promise<string> {
  const url = await optionalAudioUrl(bookId, chapterId);
  if (!url) throw new Error("That chapter isn't in the current audiobook folder.");
  return url;
}

export async function optionalAudioUrl(bookId: string, chapterId: string): Promise<string | null> {
  const key = audioKey(bookId, chapterId);
  const cached = urls.get(key);
  if (cached) return cached;
  const loc = await ensureLocation();
  if (loc.kind === "folder" && (await permissionOf(loc.handle)) !== "granted") return null;
  const blob = await readAudio(loc, bookId, chapterId);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urls.set(key, url);
  return url;
}

export async function saveChapterAudio(bookId: string, chapterId: string, blob: Blob) {
  const loc = await requireWritable();
  const key = audioKey(bookId, chapterId);
  const previous = urls.get(key);
  if (previous) URL.revokeObjectURL(previous);
  const url = URL.createObjectURL(blob);
  urls.set(key, url);
  await writeAudio(loc, bookId, chapterId, blob);
  if (loc.kind === "browser") await rememberVaultChapter(bookId, chapterId, blob);
}

export async function storedChapterIds(bookId: string): Promise<string[]> {
  const loc = await ensureLocation();
  const files = await listAudioRefs(loc);
  return files.filter((file) => file.bookId === bookId).map((file) => file.chapterId);
}
