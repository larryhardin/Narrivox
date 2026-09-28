import { createServerFn } from "@tanstack/react-start";
import { mergeHits, searchAppleBooks, searchAudible, searchOpenLibrary, type BookHit } from "@/lib/book-sources";

export const lookupBooks = createServerFn({ method: "POST" })
  .validator((input: { q?: string }) => {
    const q = typeof input?.q === "string" ? input.q.trim().slice(0, 80) : "";
    if (q.length < 2) throw new Error("Type a little more of the title.");
    return { q };
  })
  .handler(async ({ data }): Promise<BookHit[]> => {
    const settled = await Promise.allSettled([
      searchAudible(data.q),
      searchAppleBooks(data.q),
      searchOpenLibrary(data.q),
    ]);
    const groups = settled.map((item) => (item.status === "fulfilled" ? item.value : []));
    return mergeHits(groups);
  });
