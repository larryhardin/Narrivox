import type { UserBook } from "@/lib/types";

const MANIFEST = "narrivox.json";
const AUDIO_DIR = "audio";

export function audioFileName(bookId: string, chapterId: string) {
  return encodeURIComponent(`${bookId}\n${chapterId}`);
}

export function parseAudioFileName(name: string): { bookId: string; chapterId: string } | null {
  try {
    const decoded = decodeURIComponent(name);
    const split = decoded.indexOf("\n");
    if (split <= 0 || split === decoded.length - 1) return null;
    return { bookId: decoded.slice(0, split), chapterId: decoded.slice(split + 1) };
  } catch {
    return null;
  }
}

export function isUserBook(value: unknown): value is UserBook {
  if (!value || typeof value !== "object") return false;
  const book = value as UserBook;
  return (
    typeof book.id === "string" &&
    typeof book.title === "string" &&
    typeof book.author === "string" &&
    typeof book.createdAt === "number" &&
    Array.isArray(book.chapters) &&
    book.chapters.every(
      (chapter) =>
        !!chapter && typeof chapter.id === "string" && typeof chapter.title === "string",
    )
  );
}

async function audioDir(root: FileSystemDirectoryHandle, create: boolean) {
  return root.getDirectoryHandle(AUDIO_DIR, { create });
}

export async function listFolderBooks(root: FileSystemDirectoryHandle): Promise<UserBook[]> {
  try {
    const handle = await root.getFileHandle(MANIFEST);
    const text = await (await handle.getFile()).text();
    const parsed = JSON.parse(text) as { books?: unknown };
    if (!Array.isArray(parsed.books)) return [];
    return parsed.books.filter(isUserBook);
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return [];
    if (error instanceof SyntaxError) return [];
    throw error;
  }
}

export async function writeFolderBooks(root: FileSystemDirectoryHandle, books: UserBook[]) {
  const handle = await root.getFileHandle(MANIFEST, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify({ books }, null, 2));
  await writable.close();
}

export async function listFolderAudio(root: FileSystemDirectoryHandle) {
  const found: { bookId: string; chapterId: string; bytes: number }[] = [];
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await audioDir(root, false);
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return found;
    throw error;
  }
  for await (const [name, entry] of dir.entries()) {
    if (entry.kind !== "file") continue;
    const parsed = parseAudioFileName(name);
    if (!parsed) continue;
    const file = await entry.getFile();
    if (file.size <= 0) continue;
    found.push({ ...parsed, bytes: file.size });
  }
  return found;
}

export async function readFolderAudio(
  root: FileSystemDirectoryHandle,
  bookId: string,
  chapterId: string,
): Promise<Blob | null> {
  try {
    const dir = await audioDir(root, false);
    const handle = await dir.getFileHandle(audioFileName(bookId, chapterId));
    const file = await handle.getFile();
    if (file.size <= 0) return null;
    return file;
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return null;
    throw error;
  }
}

export async function writeFolderAudio(
  root: FileSystemDirectoryHandle,
  bookId: string,
  chapterId: string,
  blob: Blob,
) {
  const dir = await audioDir(root, true);
  const handle = await dir.getFileHandle(audioFileName(bookId, chapterId), { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export async function deleteFolderAudio(
  root: FileSystemDirectoryHandle,
  bookId: string,
  chapterId: string,
) {
  try {
    const dir = await audioDir(root, false);
    await dir.removeEntry(audioFileName(bookId, chapterId));
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return;
    throw error;
  }
}

export async function clearFolderLibrary(root: FileSystemDirectoryHandle) {
  let dir: FileSystemDirectoryHandle | null = null;
  try {
    dir = await audioDir(root, false);
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
  }
  if (dir) {
    const names: string[] = [];
    for await (const [name, entry] of dir.entries()) {
      if (entry.kind === "file") names.push(name);
    }
    for (const name of names) await dir.removeEntry(name);
  }
  await writeFolderBooks(root, []);
}
