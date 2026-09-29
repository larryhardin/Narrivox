import type { CatalogBook } from "@/lib/catalog";
import { saveChapterAudio, storedChapterIds } from "@/lib/library-db";
import { findCatalogBook } from "@/lib/public-search";

export type DownloadPhase = "idle" | "saving" | "saved" | "error";

export type DownloadStatus = {
  phase: DownloadPhase;
  received: number;
  total: number;
  chapter: number;
  chapters: number;
  message: string;
};

const EMPTY: DownloadStatus = {
  phase: "idle",
  received: 0,
  total: 0,
  chapter: 0,
  chapters: 0,
  message: "",
};

const status = new Map<string, DownloadStatus>();
const listeners = new Map<string, Set<() => void>>();
const running = new Set<string>();

function publish(bookId: string, next: DownloadStatus) {
  status.set(bookId, next);
  listeners.get(bookId)?.forEach((listener) => listener());
}

export function getDownloadStatus(bookId: string): DownloadStatus {
  return status.get(bookId) ?? EMPTY;
}

export function subscribeDownload(bookId: string, listener: () => void) {
  const set = listeners.get(bookId) ?? new Set();
  set.add(listener);
  listeners.set(bookId, set);
  return () => set.delete(listener);
}

export function formatBytes(bytes: number) {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

async function pullChapter(url: string, onChunk: (loaded: number, total: number) => void) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("The recording could not be reached.");
  const expected = Number(response.headers.get("content-length")) || 0;
  if (!response.body) {
    const blob = await response.blob();
    onChunk(blob.size, blob.size);
    return blob;
  }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    parts.push(value);
    loaded += value.byteLength;
    onChunk(loaded, expected || loaded);
  }
  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.byteLength;
  }
  return new Blob([merged], { type: "audio/mpeg" });
}

function totalBytes(book: CatalogBook) {
  return book.chapters.reduce((sum, chapter) => sum + chapter.bytes, 0);
}

export function catalogBytes(bookId: string) {
  const book = findCatalogBook(bookId);
  return book ? totalBytes(book) : 0;
}

export async function refreshSaved(bookId: string) {
  const book = findCatalogBook(bookId);
  if (!book) return;
  const saved = new Set(await storedChapterIds(bookId));
  const complete = book.chapters.every((chapter) => saved.has(chapter.id));
  if (running.has(bookId)) return;
  if (complete) {
    publish(bookId, {
      phase: "saved",
      received: catalogBytes(bookId),
      total: catalogBytes(bookId),
      chapter: book.chapters.length,
      chapters: book.chapters.length,
      message: "Full recording saved on this device.",
    });
  }
}

export function startFullDownload(bookId: string) {
  const book = findCatalogBook(bookId);
  if (!book || running.has(bookId)) return;
  void runDownload(book);
}

async function runDownload(book: CatalogBook) {
  running.add(book.id);
  const total = totalBytes(book);
  try {
    const saved = new Set(await storedChapterIds(book.id));
    let received = book.chapters
      .filter((chapter) => saved.has(chapter.id))
      .reduce((sum, chapter) => sum + chapter.bytes, 0);
    publish(book.id, {
      phase: "saving",
      received,
      total,
      chapter: saved.size,
      chapters: book.chapters.length,
      message: "Downloading the full LibriVox recording…",
    });
    let index = 0;
    for (const chapter of book.chapters) {
      index += 1;
      if (saved.has(chapter.id)) continue;
      const base = received;
      const blob = await pullChapter(chapter.src, (loaded, expected) => {
        const chapterTotal = expected || chapter.bytes;
        publish(book.id, {
          phase: "saving",
          received: base + Math.min(loaded, chapterTotal),
          total,
          chapter: index,
          chapters: book.chapters.length,
          message: `Saving chapter ${index} of ${book.chapters.length}`,
        });
      });
      if (blob.size < 10_000) throw new Error("The recording came back incomplete.");
      await saveChapterAudio(book.id, chapter.id, blob);
      received = base + blob.size;
      saved.add(chapter.id);
    }
    publish(book.id, {
      phase: "saved",
      received,
      total: received,
      chapter: book.chapters.length,
      chapters: book.chapters.length,
      message: "Full recording saved on this device.",
    });
  } catch (error) {
    publish(book.id, {
      phase: "error",
      received: getDownloadStatus(book.id).received,
      total,
      chapter: getDownloadStatus(book.id).chapter,
      chapters: book.chapters.length,
      message: error instanceof Error ? error.message : "The download stopped.",
    });
  } finally {
    running.delete(book.id);
  }
}
