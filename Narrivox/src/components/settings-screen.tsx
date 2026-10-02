import { useEffect, useRef, useState } from "react";
import { ArrowLeft, FolderOpen } from "lucide-react";
import { pushBackLayer } from "@/lib/back-stack";
import { formatBytes } from "@/lib/full-book";
import {
  allowFolderAccess,
  chooseStorageLocation,
  commitStorage,
  discardDeviceFolder,
  friendlyStorageError,
  storageStatus,
  type StorageStatus,
} from "@/lib/library-db";

function savedPhrase(status: { books: number; files: number; bytes: number }) {
  if (status.books === 0 && status.files === 0) return "Nothing saved here yet.";
  const parts: string[] = [];
  if (status.books > 0) parts.push(`${status.books} ${status.books === 1 ? "book" : "books"}`);
  if (status.files > 0) {
    parts.push(`${status.files} audio ${status.files === 1 ? "file" : "files"}`);
  }
  const size = status.bytes > 0 ? ` · ${formatBytes(status.bytes)}` : "";
  return `${parts.join(" · ")}${size}`;
}

export function StorageBanner({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    storageStatus()
      .then((next) => {
        if (live) setStatus(next);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  async function allow() {
    setError("");
    try {
      setStatus(await allowFolderAccess());
      onChange();
    } catch (caught) {
      setError(friendlyStorageError(caught) ?? "Access wasn't granted.");
    }
  }

  if (!status) return null;
  if (status.kind === "folder" && status.permission !== "granted") {
    return (
      <div className="mb-6 rounded-lg bg-surface px-4 py-3">
        <p>
          Audiobooks are stored in “{status.label}”. Allow access to play them.
        </p>
        <button type="button" className="btn btn-primary mt-3" onClick={() => void allow()}>
          Allow access
        </button>
        {error && <p className="mt-2 text-sm text-muted">{error}</p>}
      </div>
    );
  }
  if (status.lostFolder) {
    return (
      <p className="mb-6 text-sm text-muted">
        The folder “{status.lostFolder}” could not be opened again. Choose it in Settings. Anything
        already moved is still in that folder.
      </p>
    );
  }
  return null;
}

export function SettingsScreen({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => pushBackLayer(() => onCloseRef.current()), []);

  async function reload() {
    setStatus(await storageStatus());
  }

  useEffect(() => {
    let live = true;
    storageStatus()
      .then((next) => {
        if (live) setStatus(next);
      })
      .catch((caught) => {
        if (live) setError(friendlyStorageError(caught) ?? "Storage couldn't be read.");
      });
    return () => {
      live = false;
    };
  }, []);

  async function choose() {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const target = await chooseStorageLocation();
      if (target === "cancel") return;
      if (target === "same") {
        setMessage("Already using this location.");
        return;
      }
      const current = status ?? (await storageStatus());
      const hasFiles = current.books > 0 || current.files > 0;
      if (hasFiles) setMoving({ done: 0, total: current.files });
      const result = await commitStorage(target, hasFiles, (done, total) => {
        setMoving({ done, total });
      });
      const where = target.kind === "device" ? target.name : target.kind === "folder" ? target.handle.name || "the new folder" : "this browser";
      if (result.moved && result.leftover) {
        setMessage(`Moved into ${where}. Some copies may still be in the old place.`);
      } else if (result.moved) {
        setMessage(`Moved into ${where}.`);
      } else {
        setMessage(`Audiobooks will be kept in ${where}.`);
      }
      await reload();
      onChanged();
    } catch (caught) {
      discardDeviceFolder();
      setError(friendlyStorageError(caught) ?? "That location couldn't be used.");
    } finally {
      setMoving(null);
      setBusy(false);
    }
  }

  const location = status?.label ?? "Checking…";

  return (
    <main className="mx-auto max-w-3xl px-5 py-5 pb-24">
      <button type="button" className="btn btn-quiet" onClick={onClose}>
        <ArrowLeft className="h-4 w-4" />
        Shelf
      </button>
      <h1 className="mt-5 text-3xl">Settings</h1>
      <section className="mt-6 rounded-lg border border-border bg-raised p-4">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-5 w-5 text-primary" aria-hidden />
          <h2 className="text-xl">Audiobook storage</h2>
        </div>
        <p className="mt-2 text-sm text-muted">
          Books are kept in the location below. Choosing a different folder moves the books that are
          already saved.
        </p>
        <p className="mt-4 text-sm text-muted">Location</p>
        <div className="mt-1 flex items-center gap-2">
          <div className="field flex min-w-0 flex-1 items-center truncate" aria-readonly="true" title={location}>
            {location}
          </div>
          <button type="button" className="btn btn-primary shrink-0" disabled={busy} onClick={() => void choose()}>
            Choose
          </button>
        </div>
        <p className="mt-2 text-sm text-muted">{status ? savedPhrase(status) : ""}</p>
        {status?.kind === "folder" && status.permission !== "granted" && (
          <button
            type="button"
            className="btn btn-primary mt-4"
            disabled={busy}
            onClick={() =>
              void allowFolderAccess()
                .then((next) => {
                  setStatus(next);
                  setError("");
                  onChanged();
                })
                .catch((caught) => {
                  setError(friendlyStorageError(caught) ?? "Access wasn't granted.");
                })
            }
          >
            Allow access
          </button>
        )}
        {moving && (
          <div className="mt-4">
            <div className="bar" aria-hidden>
              <span
                style={{
                  width: `${moving.total === 0 ? 100 : Math.round((moving.done / moving.total) * 100)}%`,
                }}
              />
            </div>
            <p className="mt-2 text-sm text-muted" role="status">
              {moving.total === 0 ? "Moving the catalog…" : `Moving ${moving.done} of ${moving.total}`}
            </p>
          </div>
        )}
        {message && <p className="mt-3 text-sm">{message}</p>}
        {error && <p className="mt-3 text-sm text-muted">{error}</p>}
      </section>

      <section className="mt-4 rounded-lg border border-border bg-raised p-4">
        <h2 className="text-xl">Interface</h2>
        <p className="mt-3 text-sm text-muted">
          Swiping back on the home shelf leaves Narrivox running. The story keeps playing, and the
          lock screen shows pause and the 15-second and 30-second skips.
        </p>
      </section>
    </main>
  );
}
