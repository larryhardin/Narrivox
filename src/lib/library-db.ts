import type { UserBook } from "@/lib/types";

const DB_NAME = "nightstand";
const DB_VERSION = 1;

const urls = new Map<string, string>();

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

export async function listUserBooks(): Promise<UserBook[]> {
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

export async function saveUserBook(book: UserBook, files: { id: string; file: Blob }[]) {
  const db = await openDb();
  try {
    const tx = db.transaction(["books", "audio"], "readwrite");
    tx.objectStore("books").put(book);
    for (const file of files) {
      tx.objectStore("audio").put(file.file, `${book.id}:${file.id}`);
    }
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

export async function deleteUserBook(book: UserBook) {
  const db = await openDb();
  try {
    const tx = db.transaction(["books", "audio"], "readwrite");
    tx.objectStore("books").delete(book.id);
    for (const chapter of book.chapters) {
      tx.objectStore("audio").delete(`${book.id}:${chapter.id}`);
    }
    await transactionDone(tx);
  } finally {
    db.close();
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
  return urls.get(`${bookId}:${chapterId}`) ?? null;
}

export async function getAudioUrl(bookId: string, chapterId: string): Promise<string> {
  const url = await optionalAudioUrl(bookId, chapterId);
  if (!url) throw new Error("That chapter is missing from this device.");
  return url;
}

export async function optionalAudioUrl(bookId: string, chapterId: string): Promise<string | null> {
  const key = `${bookId}:${chapterId}`;
  const cached = urls.get(key);
  if (cached) return cached;
  const db = await openDb();
  try {
    const tx = db.transaction("audio", "readonly");
    const blob = await requestToPromise(tx.objectStore("audio").get(key));
    await transactionDone(tx);
    if (!(blob instanceof Blob) || blob.size === 0) return null;
    const url = URL.createObjectURL(blob);
    urls.set(key, url);
    return url;
  } finally {
    db.close();
  }
}

export async function saveChapterAudio(bookId: string, chapterId: string, blob: Blob) {
  const key = `${bookId}:${chapterId}`;
  const previous = urls.get(key);
  if (previous) URL.revokeObjectURL(previous);
  const url = URL.createObjectURL(blob);
  urls.set(key, url);
  const db = await openDb();
  try {
    const tx = db.transaction("audio", "readwrite");
    tx.objectStore("audio").put(blob, key);
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

export async function storedChapterIds(bookId: string): Promise<string[]> {
  const db = await openDb();
  try {
    const tx = db.transaction("audio", "readonly");
    const keys = await requestToPromise(tx.objectStore("audio").getAllKeys());
    await transactionDone(tx);
    const prefix = `${bookId}:`;
    return keys
      .filter((key): key is string => typeof key === "string" && key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
  } finally {
    db.close();
  }
}
