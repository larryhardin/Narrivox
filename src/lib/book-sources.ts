export type BookHit = {
  source: "Audible" | "Apple Books" | "Open Library";
  title: string;
  author: string;
  year?: string;
  narrator?: string;
  cover?: string;
};

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function mergeHits(groups: BookHit[][]) {
  const seen = new Set<string>();
  const hits: BookHit[] = [];
  for (const group of groups) {
    for (const hit of group) {
      const key = `${hit.title.toLowerCase().replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim()}|${hit.author.toLowerCase()}`;
      if (!hit.title || seen.has(key)) continue;
      seen.add(key);
      hits.push(hit);
      if (hits.length >= 6) return hits;
    }
  }
  return hits;
}

export async function searchOpenLibrary(query: string, signal?: AbortSignal): Promise<BookHit[]> {
  const url = new URL("https://openlibrary.org/search.json");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "5");
  url.searchParams.set("fields", "title,author_name,first_publish_year,cover_i");
  const response = await fetch(url, { signal });
  if (!response.ok) return [];
  const payload = (await response.json()) as { docs?: Record<string, unknown>[] };
  return (payload.docs ?? []).flatMap((doc) => {
    const title = asText(doc.title);
    const authors = Array.isArray(doc.author_name) ? doc.author_name : [];
    const author = asText(authors[0]) || "Unknown";
    if (!title) return [];
    const coverId = typeof doc.cover_i === "number" ? doc.cover_i : 0;
    const year = typeof doc.first_publish_year === "number" ? String(doc.first_publish_year) : "";
    return [
      {
        source: "Open Library" as const,
        title,
        author,
        year,
        cover: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : undefined,
      },
    ];
  });
}

export async function searchAppleBooks(query: string, signal?: AbortSignal): Promise<BookHit[]> {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", query);
  url.searchParams.set("entity", "audiobook");
  url.searchParams.set("limit", "5");
  const response = await fetch(url, { signal });
  if (!response.ok) return [];
  const payload = (await response.json()) as { results?: Record<string, unknown>[] };
  return (payload.results ?? []).flatMap((item) => {
    const title = asText(item.collectionName).replace(/\s*\(Unabridged\)\s*/i, "").trim();
    const author = asText(item.artistName) || "Unknown";
    if (!title) return [];
    const art = asText(item.artworkUrl100).replace("100x100bb", "600x600bb");
    return [
      {
        source: "Apple Books" as const,
        title,
        author,
        cover: art || undefined,
      },
    ];
  });
}

type AudibleProduct = {
  title?: string;
  authors?: { name?: string }[];
  narrators?: { name?: string }[];
  release_date?: string;
  product_images?: Record<string, string>;
};

export async function searchAudible(query: string, signal?: AbortSignal): Promise<BookHit[]> {
  const url = new URL("https://api.audible.com/1.0/catalog/products");
  url.searchParams.set("response_groups", "contributors,media,product_attrs");
  url.searchParams.set("num_results", "5");
  url.searchParams.set("products_sort_by", "Relevance");
  url.searchParams.set("keywords", query);
  const response = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as { products?: AudibleProduct[] };
  return (payload.products ?? []).flatMap((product) => {
    const title = asText(product.title);
    const author = asText(product.authors?.[0]?.name) || "Unknown";
    if (!title) return [];
    const narrators = (product.narrators ?? []).map((person) => asText(person.name)).filter(Boolean);
    const images = product.product_images ?? {};
    const cover = images["500"] || images["1024"] || Object.values(images)[0];
    return [
      {
        source: "Audible" as const,
        title,
        author,
        year: asText(product.release_date).slice(0, 4),
        narrator: narrators.slice(0, 2).join(", "),
        cover,
      },
    ];
  });
}
