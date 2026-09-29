import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { CoverArt } from "@/components/cover";
import { readAudioTags, titleFromFilename } from "@/lib/audio-tags";
import { searchBookMeta, type BookHit } from "@/lib/book-meta";
import { saveUserBook } from "@/lib/library-db";
import type { UserBook } from "@/lib/types";

const AUDIO_NAME = /\.(mp3|m4a|aac|wav|ogg|flac|mpeg|mp4|webm|m4b)$/i;

function isAudio(file: File) {
  return file.type.startsWith("audio/") || file.type === "video/mp4" || AUDIO_NAME.test(file.name);
}

function prettyName(name: string, index: number) {
  const base = name
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return base || `Chapter ${index + 1}`;
}

async function shrinkCover(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  const max = 640;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return blobToDataUrl(blob);
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function AddBookDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [year, setYear] = useState("");
  const [narrator, setNarrator] = useState("");
  const [cover, setCover] = useState("");
  const [coverFromFile, setCoverFromFile] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [hits, setHits] = useState<BookHit[]>([]);
  const [looking, setLooking] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const heldQuery = useRef("");

  function reset() {
    setTitle("");
    setAuthor("");
    setYear("");
    setNarrator("");
    setCover("");
    setCoverFromFile(false);
    setFiles([]);
    setHits([]);
    setLooking(false);
    setNote("");
    setError(null);
    setSaving(false);
    heldQuery.current = "";
  }

  useEffect(() => {
    const query = title.trim();
    if (query.length < 2 || query.toLowerCase() === heldQuery.current) {
      setHits([]);
      setLooking(false);
      return;
    }
    const controller = new AbortController();
    setLooking(true);
    const timer = window.setTimeout(() => {
      searchBookMeta(query, controller.signal)
        .then((next) => {
          if (!controller.signal.aborted) setHits(next);
        })
        .catch((reason: unknown) => {
          if (controller.signal.aborted || (reason as { name?: string })?.name === "AbortError") return;
          if (!controller.signal.aborted) setHits([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLooking(false);
        });
    }, 350);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [title]);

  useEffect(() => {
    const file = files[0];
    if (!file) return;
    let cancel = false;
    setNote("Reading the file…");
    void readAudioTags(file)
      .then(async (tags) => {
        if (cancel) return;
        const guessed = tags.album || tags.title || titleFromFilename(file.name);
        const guessedAuthor = tags.albumArtist || tags.artist || "";
        setTitle((current) => current || guessed);
        setAuthor((current) => current || guessedAuthor);
        if (tags.picture) {
          let dataUrl = "";
          try {
            dataUrl = await shrinkCover(tags.picture);
          } catch {
            dataUrl = await blobToDataUrl(tags.picture);
          }
          if (cancel) return;
          setCover(dataUrl);
          setCoverFromFile(true);
          setNote("Cover found inside the file. The title is matched against Audible and other catalogs.");
          return;
        }
        setNote(guessed ? "No cover in the file. Matching the name against public catalogs." : "");
      })
      .catch(() => {
        if (!cancel) setNote("");
      });
    return () => {
      cancel = true;
    };
  }, [files]);

  function applyHit(hit: BookHit) {
    heldQuery.current = hit.title.trim().toLowerCase();
    setTitle(hit.title);
    setAuthor(hit.author);
    if (hit.year) setYear(hit.year);
    if (hit.narrator) setNarrator(hit.narrator);
    if (!coverFromFile && hit.cover) setCover(hit.cover);
    setHits([]);
    setNote(`Using ${hit.source}.`);
  }

  function move(index: number, dir: -1 | 1) {
    setFiles((current) => {
      const next = current.slice();
      const target = index + dir;
      if (target < 0 || target >= next.length) return current;
      const [item] = next.splice(index, 1);
      if (!item) return current;
      next.splice(target, 0, item);
      return next;
    });
  }

  async function save() {
    const name = title.trim();
    if (!name) {
      setError("Give the book a title.");
      return;
    }
    if (files.length === 0) {
      setError("Add at least one audio file.");
      return;
    }
    setSaving(true);
    setError(null);
    const book: UserBook = {
      id: crypto.randomUUID(),
      title: name,
      author: author.trim() || "Unknown",
      year: year || undefined,
      narrator: narrator || undefined,
      cover: cover || undefined,
      createdAt: Date.now(),
      chapters: files.map((file, index) => ({
        id: crypto.randomUUID(),
        title: prettyName(file.name, index),
      })),
    };
    try {
      await saveUserBook(
        book,
        book.chapters.map((chapter, index) => ({ id: chapter.id, file: files[index]! })),
      );
      reset();
      onOpenChange(false);
      onSaved();
    } catch {
      setError("That book couldn't be saved on this device.");
      setSaving(false);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog-panel">
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="font-display text-2xl">Add a book</Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label="Close">
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-2 text-sm text-muted">
            The audio stays on this device. Only the title is looked up, on Audible and other public catalogs.
          </Dialog.Description>
          {cover && (
            <div className="mt-4 flex items-center gap-3">
              <div className="w-16 shrink-0">
                <CoverArt title={title || "Book"} src={cover} />
              </div>
              <p className="text-sm text-muted">
                {coverFromFile ? "Cover taken from the audio file." : "Cover from the catalog match."}
              </p>
            </div>
          )}
          <label className="mt-5 block text-sm text-muted" htmlFor="book-title">
            Title
          </label>
          <input
            id="book-title"
            className="field mt-1"
            value={title}
            placeholder="Search Audible, Apple Books, Open Library"
            onChange={(event) => {
              heldQuery.current = "";
              setTitle(event.target.value);
            }}
            autoComplete="off"
          />
          {looking && <p className="mt-2 text-sm text-muted">Searching catalogs…</p>}
          {hits.length > 0 && (
            <ul className="mt-2 flex flex-col">
              {hits.map((hit) => (
                <li key={`${hit.source}-${hit.title}-${hit.author}`}>
                  <button type="button" className="chapter-row" onClick={() => applyHit(hit)}>
                    <span className="w-10 shrink-0">
                      <CoverArt title={hit.title} src={hit.cover} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display">{hit.title}</span>
                      <span className="block truncate text-sm text-muted">
                        {hit.author} · {hit.source}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="mt-3 block text-sm text-muted" htmlFor="book-author">
            Author
          </label>
          <input
            id="book-author"
            className="field mt-1"
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
            autoComplete="off"
          />
          <label className="btn btn-quiet mt-4 cursor-pointer">
            <Plus className="h-4 w-4" />
            Choose audio
            <input
              type="file"
              accept="audio/*,.mp3,.m4a,.m4b,.aac,.wav,.ogg,.flac"
              multiple
              className="sr-only"
              onChange={(event) => {
                const picked = Array.from(event.target.files ?? []);
                const accepted = picked.filter(isAudio);
                if (accepted.length !== picked.length) {
                  setError("Skipped a file that didn't look like audio.");
                }
                setFiles((current) => [...current, ...accepted]);
                event.target.value = "";
              }}
            />
          </label>
          {note && <p className="mt-3 text-sm text-muted">{note}</p>}
          {files.length > 0 && (
            <ol className="mt-3 flex flex-col gap-2">
              {files.map((file, index) => (
                <li
                  key={`${file.name}-${file.size}-${index}`}
                  className="flex items-center gap-2 rounded-md bg-surface px-2 py-1"
                >
                  <span className="w-5 shrink-0 text-sm tabular-nums text-muted">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{prettyName(file.name, index)}</span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Move chapter up"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Move chapter down"
                    disabled={index === files.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Remove file"
                    onClick={() => setFiles((current) => current.filter((_, item) => item !== index))}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ol>
          )}
          {error && (
            <p className="mt-3 text-sm text-primary" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="btn btn-primary mt-5 w-full" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save to this device"}
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
