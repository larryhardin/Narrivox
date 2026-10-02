export type FolderChapter = {
  position: number;
  index: number;
  title: string;
};

export type FolderImport =
  | { ok: true; title: string; author: string; chapters: FolderChapter[] }
  | { ok: false; error: string };

const NO_AUDIO = "This folder has no audio files.";
const NO_ORDER = "The chapter order isn't clear. Each file needs a number, like 01 of 21.";
const BAD_SEQUENCE = "The chapter numbers aren't a complete sequence, so the order isn't clear.";

type Parsed = {
  index: number;
  total: number | null;
};

function bareName(fileName: string) {
  const base = fileName.split(/[/\\]/).pop() ?? fileName;
  return base.replace(/\.[^.]+$/, "");
}

function parseName(fileName: string): Parsed | null {
  const bare = bareName(fileName);
  const ofMatch = bare.match(/^(?:(.+)[_\s.-]+)?(\d+)[_\s.-]*of[_\s.-]*(\d+)$/i);
  if (ofMatch) {
    const index = Number(ofMatch[2]);
    const total = Number(ofMatch[3]);
    if (!Number.isInteger(index) || !Number.isInteger(total) || index < 1 || total < 1) return null;
    return { index, total };
  }
  const numbered = bare.match(/^(?:(.+)[_\s.-]+)?(\d+)$/);
  if (!numbered) return null;
  const index = Number(numbered[2]);
  if (!Number.isInteger(index) || index < 1) return null;
  return { index, total: null };
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

export function orderFolderAudio(folderName: string, fileNames: string[]): FolderImport {
  const book = bookFromFolder(folderName);
  if (!book.title) return { ok: false, error: NO_AUDIO };
  if (fileNames.length === 0) return { ok: false, error: NO_AUDIO };

  if (fileNames.length === 1 && !parseName(fileNames[0]!)) {
    return {
      ok: true,
      title: book.title,
      author: book.author,
      chapters: [{ position: 0, index: 1, title: "Chapter 1" }],
    };
  }

  const parsed = fileNames.map((name) => parseName(name));
  if (parsed.some((item) => item === null)) return { ok: false, error: NO_ORDER };
  const chapters = parsed as Parsed[];

  const withTotal = chapters.filter((item) => item.total !== null);
  if (withTotal.length !== 0 && withTotal.length !== chapters.length) return { ok: false, error: NO_ORDER };
  if (withTotal.length === chapters.length) {
    const total = chapters[0]!.total;
    if (chapters.some((item) => item.total !== total) || total !== chapters.length) {
      return { ok: false, error: BAD_SEQUENCE };
    }
  }

  const indexes = new Set(chapters.map((item) => item.index));
  if (indexes.size !== chapters.length) return { ok: false, error: BAD_SEQUENCE };
  for (let number = 1; number <= chapters.length; number += 1) {
    if (!indexes.has(number)) return { ok: false, error: BAD_SEQUENCE };
  }

  const ordered = chapters
    .map((item, position) => ({ position, index: item.index, title: `Chapter ${item.index}` }))
    .sort((a, b) => a.index - b.index);

  return { ok: true, title: book.title, author: book.author, chapters: ordered };
}
