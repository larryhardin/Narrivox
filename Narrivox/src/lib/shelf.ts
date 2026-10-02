import { BOOKS, type CatalogBook } from "@/lib/catalog";
import { findCatalogBook, listPublicBooks } from "@/lib/public-search";
import type { ProgressEntry, ShelfBook, UserBook } from "@/lib/types";

export function fromCatalog(book: CatalogBook): ShelfBook {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    year: book.year,
    narrator: book.narrator,
    blurb: book.blurb,
    cover: book.cover,
    source: "library",
    chapters: book.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      src: chapter.src,
      text: chapter.text,
    })),
  };
}

export function fromUser(book: UserBook): ShelfBook {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    source: "yours",
    year: book.year,
    narrator: book.narrator,
    cover: book.cover,
    chapters: book.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
    })),
  };
}

export function libraryShelf(): ShelfBook[] {
  const saved = listPublicBooks().filter((book) => !BOOKS.some((item) => item.id === book.id));
  return [...BOOKS, ...saved].map(fromCatalog);
}

export function findShelf(id: string, userBooks: UserBook[]): ShelfBook | null {
  const sample = findCatalogBook(id);
  if (sample) return fromCatalog(sample);
  const yours = userBooks.find((book) => book.id === id);
  if (yours) return fromUser(yours);
  return null;
}

export function listenedFraction(
  book: { id: string; chapters: { id: string }[] },
  entry: ProgressEntry | undefined,
  durations: Record<string, number>,
): number {
  if (!entry) return 0;
  if (entry.finished) return 1;
  let known = 0;
  let total = 0;
  let heard = 0;
  for (const chapter of book.chapters) {
    const duration = durations[`${book.id}:${chapter.id}`];
    if (!duration) continue;
    known += 1;
    total += duration;
    const time = entry.done.includes(chapter.id)
      ? duration
      : Math.min(entry.times[chapter.id] ?? 0, duration);
    heard += time;
  }
  if (known === book.chapters.length && total > 0) return heard / total;
  const index = Math.max(
    0,
    book.chapters.findIndex((chapter) => chapter.id === entry.chapterId),
  );
  const inChapter = durations[`${book.id}:${entry.chapterId}`];
  const partial = inChapter ? Math.min(1, (entry.times[entry.chapterId] ?? 0) / inChapter) : 0;
  return (index + partial) / Math.max(1, book.chapters.length);
}
