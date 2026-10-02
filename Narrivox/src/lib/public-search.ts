import { BOOKS, type CatalogBook, type CatalogChapter } from "@/lib/catalog";
import { persistConfig } from "@/lib/app-vault";

const KEY = "nightstand-public-books";
const ARCHIVE = "https://archive.org";

export type PublicHit = {
  identifier: string;
  title: string;
  author: string;
  cover: string;
};

function asText(value: unknown): string {
  if (Array.isArray(value)) return asText(value[0]);
  return typeof value === "string" ? value.trim() : "";
}

function isChapter(value: unknown): value is CatalogChapter {
  if (!value || typeof value !== "object") return false;
  const chapter = value as CatalogChapter;
  return (
    typeof chapter.id === "string" &&
    typeof chapter.title === "string" &&
    typeof chapter.src === "string" &&
    typeof chapter.bytes === "number"
  );
}

function isBook(value: unknown): value is CatalogBook {
  if (!value || typeof value !== "object") return false;
  const book = value as CatalogBook;
  return (
    typeof book.id === "string" &&
    typeof book.title === "string" &&
    typeof book.author === "string" &&
    Array.isArray(book.chapters) &&
    book.chapters.every(isChapter)
  );
}

export function listPublicBooks(): CatalogBook[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter(isBook);
  } catch {
    return [];
  }
}

export function savePublicBook(book: CatalogBook) {
  const next = [book, ...listPublicBooks().filter((item) => item.id !== book.id)].slice(0, 24);
  localStorage.setItem(KEY, JSON.stringify(next));
  persistConfig();
}

export function findCatalogBook(id: string): CatalogBook | undefined {
  return BOOKS.find((book) => book.id === id) ?? listPublicBooks().find((book) => book.id === id);
}

function safeQuery(query: string) {
  return query
    .replace(/[+\-!(){}[\]^"~*?:\\/&|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export async function searchPublicDomain(query: string, signal?: AbortSignal): Promise<PublicHit[]> {
  const terms = safeQuery(query);
  if (terms.length < 2) return [];
  const q = `collection:librivoxaudio AND mediatype:audio AND (title:(${terms}) OR creator:(${terms}))`;
  const url = new URL(`${ARCHIVE}/advancedsearch.php`);
  url.searchParams.set("q", q);
  url.searchParams.append("fl[]", "identifier");
  url.searchParams.append("fl[]", "title");
  url.searchParams.append("fl[]", "creator");
  url.searchParams.set("rows", "8");
  url.searchParams.set("page", "1");
  url.searchParams.set("output", "json");
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("The public-domain catalog didn't answer.");
  const payload = (await response.json()) as { response?: { docs?: unknown[] } };
  const docs = payload.response?.docs ?? [];
  const hits: PublicHit[] = [];
  for (const doc of docs) {
    if (!doc || typeof doc !== "object") continue;
    const row = doc as { identifier?: unknown; title?: unknown; creator?: unknown };
    const identifier = asText(row.identifier);
    const title = asText(row.title);
    if (!identifier || !title) continue;
    hits.push({
      identifier,
      title,
      author: asText(row.creator) || "LibriVox",
      cover: `${ARCHIVE}/services/img/${identifier}`,
    });
  }
  return hits;
}

function cleanTitle(raw: string, index: number) {
  const stripped = raw.replace(/^\d+\s*[-.:]\s*/, "").trim();
  return stripped || `Chapter ${index + 1}`;
}

export async function loadPublicRecording(hit: PublicHit): Promise<CatalogBook> {
  const response = await fetch(`${ARCHIVE}/metadata/${encodeURIComponent(hit.identifier)}`);
  if (!response.ok) throw new Error("That recording couldn't be opened.");
  const payload = (await response.json()) as {
    metadata?: { title?: unknown; creator?: unknown; date?: unknown };
    files?: { name?: string; title?: string; size?: string }[];
  };
  const files = payload.files ?? [];
  const mp3s = files.filter((file) => file.name?.toLowerCase().endsWith(".mp3"));
  const names = new Set(mp3s.map((file) => file.name));
  const chosen = mp3s
    .filter((file) => {
      const name = file.name ?? "";
      if (name.includes("_64kb")) return false;
      if (name.includes("_128kb")) return !names.has(name.replace("_128kb.mp3", ".mp3"));
      return true;
    })
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", undefined, { numeric: true }));
  if (chosen.length === 0) throw new Error("That recording has no audio chapters.");
  const chapters: CatalogChapter[] = chosen.map((file, index) => {
    const name = file.name ?? `chapter-${index + 1}.mp3`;
    const id = `c${String(index + 1).padStart(2, "0")}`;
    return {
      id,
      title: cleanTitle(file.title || name.replace(/\.mp3$/i, ""), index),
      src: `${ARCHIVE}/download/${hit.identifier}/${encodeURIComponent(name)}`,
      text: "",
      bytes: Number(file.size) || 0,
    };
  });
  const year = asText(payload.metadata?.date).slice(0, 4);
  return {
    id: `ia-${hit.identifier}`,
    title: asText(payload.metadata?.title) || hit.title,
    author: asText(payload.metadata?.creator) || hit.author,
    year: /^\d{4}$/.test(year) ? year : "",
    narrator: "LibriVox",
    cover: hit.cover,
    blurb: "The full public-domain recording from LibriVox.",
    chapters,
  };
}
