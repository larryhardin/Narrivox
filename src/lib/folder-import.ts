export type FolderChapter = {
  position: number;
  index: number;
  title: string;
};

export type FolderImport =
  | { ok: true; title: string; author: string; chapters: FolderChapter[] }
  | { ok: false; error: string };

const NO_AUDIO = "This folder has no mp3 or m4a files.";
const NO_ORDER = "The chapter order isn't clear. Each file needs a number, like 1 or 1 of 11, or a track number in the file.";
const BAD_SEQUENCE = "The chapter numbers aren't a complete sequence, so the order isn't clear.";
const DUPLICATE = "Two audio files use the same chapter number.";

type Parsed = {
  index: number;
  total: number | null;
};

function bareName(fileName: string) {
  const base = fileName.split(/[/\\]/).pop() ?? fileName;
  return base.replace(/\.[^.]+$/, "").trim();
}

export function isChapterAudio(fileName: string) {
  const base = (fileName.split(/[/\\]/).pop() ?? fileName).trim();
  return /\.(mp3|m4a)$/i.test(base);
}

function parseName(fileName: string): Parsed | null {
  const bare = bareName(fileName);
  const ofHits: Parsed[] = [];
  for (const match of bare.matchAll(/(\d+)[_\s.-]*of[_\s.-]*(\d+)/gi)) {
    const index = Number(match[1]);
    const total = Number(match[2]);
    if (!Number.isInteger(index) || !Number.isInteger(total) || index < 1 || total < 1) continue;
    ofHits.push({ index, total });
  }
  if (ofHits.length === 1) return ofHits[0]!;
  if (ofHits.length > 1) {
    const first = ofHits[0]!;
    if (ofHits.every((item) => item.index === first.index && item.total === first.total)) return first;
    return null;
  }

  const numbers = [...bare.matchAll(/(?:^|[_\s.-])(\d+)(?=$|[_\s.-])/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isInteger(value) && value >= 1);
  if (numbers.length === 1) return { index: numbers[0]!, total: null };
  if (numbers.length === 0) return null;

  const trailing = bare.match(/(\d+)\s*$/);
  if (trailing) {
    const index = Number(trailing[1]);
    if (Number.isInteger(index) && index >= 1) return { index, total: null };
  }
  const leading = bare.match(/^\s*(\d+)/);
  if (leading) {
    const index = Number(leading[1]);
    if (Number.isInteger(index) && index >= 1) return { index, total: null };
  }
  return null;
}

function bookFromFolder(folderName: string) {
  const title = folderName.trim();
  const split = title.split(/\s+-\s+/);
  if (split.length >= 2) {
    const author = split[0]?.trim() ?? "";
    const bookTitle = split.slice(1).join(" - ").trim();
    if (author && bookTitle) return { title: bookTitle, author };
  }
  return { title, author: "" };
}

export function isDirectFolderFile(relativePath: string) {
  const parts = relativePath.split(/[/\\]/).filter((part) => part.length > 0);
  return parts.length === 2;
}

export function folderNameFromRelative(relativePath: string) {
  const parts = relativePath.split(/[/\\]/).filter((part) => part.length > 0);
  return parts.length >= 2 ? parts[0]! : "";
}

export function chapterTitleFor(fileName: string) {
  const parsed = parseName(fileName);
  if (!parsed) return "";
  return `Chapter ${parsed.index}`;
}

type FolderSource = string | { name: string; track?: number | null };

function sourceOf(entry: FolderSource, position: number) {
  if (typeof entry === "string") return { name: entry, position, track: null as number | null };
  const track = entry.track;
  return {
    name: entry.name,
    position,
    track: track != null && Number.isInteger(track) && track >= 1 ? track : null,
  };
}

export function orderFolderAudio(folderName: string, fileNames: FolderSource[]): FolderImport {
  const book = bookFromFolder(folderName);
  if (!book.title) return { ok: false, error: NO_AUDIO };
  const usable = fileNames
    .map((entry, position) => sourceOf(entry, position))
    .filter((item) => isChapterAudio(item.name));
  if (usable.length === 0) return { ok: false, error: NO_AUDIO };

  if (usable.length === 1 && usable[0]!.track == null && !parseName(usable[0]!.name)) {
    return {
      ok: true,
      title: book.title,
      author: book.author,
      chapters: [{ position: usable[0]!.position, index: 1, title: "Chapter 1" }],
    };
  }

  const parsed = usable.map((item) => {
    if (item.track != null) return { item, index: item.track, total: null as number | null, fromTag: true };
    const named = parseName(item.name);
    return { item, index: named?.index ?? null, total: named?.total ?? null, fromTag: false };
  });
  if (parsed.some((entry) => entry.index == null)) return { ok: false, error: NO_ORDER };
  const chapters = parsed as {
    item: { name: string; position: number; track: number | null };
    index: number;
    total: number | null;
    fromTag: boolean;
  }[];

  if (!chapters.some((entry) => entry.fromTag)) {
    const withTotal = chapters.filter((entry) => entry.total !== null);
    if (withTotal.length !== 0 && withTotal.length !== chapters.length) return { ok: false, error: NO_ORDER };
    if (withTotal.length === chapters.length) {
      const total = chapters[0]!.total;
      if (chapters.some((entry) => entry.total !== total) || total !== chapters.length) {
        return { ok: false, error: BAD_SEQUENCE };
      }
    }
  }

  const indexes = new Set(chapters.map((entry) => entry.index));
  if (indexes.size !== chapters.length) return { ok: false, error: DUPLICATE };
  for (let number = 1; number <= chapters.length; number += 1) {
    if (!indexes.has(number)) return { ok: false, error: BAD_SEQUENCE };
  }

  const ordered = chapters
    .map((entry) => ({
      position: entry.item.position,
      index: entry.index,
      title: `Chapter ${entry.index}`,
    }))
    .sort((a, b) => a.index - b.index);

  return { ok: true, title: book.title, author: book.author, chapters: ordered };
}
