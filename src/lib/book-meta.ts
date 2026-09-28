import { lookupBooks } from "@/lib/lookup-books";
import { mergeHits, searchAppleBooks, searchOpenLibrary, type BookHit } from "@/lib/book-sources";

export type { BookHit };

export async function searchBookMeta(query: string, signal?: AbortSignal): Promise<BookHit[]> {
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return [];
  try {
    const remote = await lookupBooks({ data: { q }, signal });
    if (signal?.aborted) return [];
    if (remote.length > 0) return remote;
  } catch {
    // The installed app has no lookup server. Public catalogs that allow
    // browser requests still answer.
  }
  if (signal?.aborted) return [];
  const settled = await Promise.allSettled([searchAppleBooks(q, signal), searchOpenLibrary(q, signal)]);
  return mergeHits(settled.map((item) => (item.status === "fulfilled" ? item.value : [])));
}
