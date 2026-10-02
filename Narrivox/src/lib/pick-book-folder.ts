import { folderNameFromRelative, isDirectFolderFile } from "@/lib/folder-import";

const AUDIO_NAME = /\.(mp3|m4a|aac|wav|ogg|flac|mpeg|mp4|webm|m4b)$/i;

export type PickedFolder =
  | { ok: true; folderName: string; files: File[] }
  | { ok: false; cancelled: boolean; error: string; useInput?: boolean };

type NativeFolder = {
  pickBookFolder: () => void;
  folderAudioCount: () => number;
  folderAudioName: (index: number) => string;
  folderAudioSize: (index: number) => string;
  folderName: () => string;
  folderAudioChunk: (index: number, offset: number, length: number) => string;
  releaseFolderImport: () => void;
};

type DirectoryHandle = {
  name: string;
  entries: () => AsyncIterable<[string, { kind: string; getFile: () => Promise<File> }]>;
};

function nativeFolder(): NativeFolder | null {
  if (typeof window === "undefined") return null;
  const native = (window as unknown as { NightstandNative?: Partial<NativeFolder> }).NightstandNative;
  if (!native?.pickBookFolder || !native.folderAudioChunk || !native.releaseFolderImport) return null;
  return native as NativeFolder;
}

function isAudio(file: File) {
  return file.type.startsWith("audio/") || file.type === "video/mp4" || AUDIO_NAME.test(file.name);
}

function mimeFor(name: string) {
  if (/\.(m4a|m4b|mp4|aac)$/i.test(name)) return "audio/mp4";
  if (/\.wav$/i.test(name)) return "audio/wav";
  if (/\.ogg$/i.test(name)) return "audio/ogg";
  if (/\.flac$/i.test(name)) return "audio/flac";
  return "audio/mpeg";
}

function bytesFromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function hasDirectoryPicker() {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

function isEmbeddedFrame() {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function folderPickerKind(): "native" | "browser" | "input" {
  if (typeof window === "undefined") return "input";
  if (nativeFolder()) return "native";
  // The preview iframe rejects showDirectoryPicker, and a fallback click after
  // that rejection is no longer a user gesture, so the dialog never opens.
  if (isEmbeddedFrame() || !hasDirectoryPicker()) return "input";
  return "browser";
}

async function readNativeFolder(onProgress: (message: string) => void): Promise<PickedFolder> {
  const native = nativeFolder();
  if (!native) return { ok: false, cancelled: false, error: "This device can't choose a folder." };
  const picked = await new Promise<boolean>((resolve) => {
    const target = window as unknown as {
      __narrivoxFolderPicked?: (ok: boolean) => void;
      __narrivoxFolderProgress?: (done: number, total: number) => void;
    };
    target.__narrivoxFolderProgress = (done, total) => onProgress(`Reading ${done} of ${total}…`);
    target.__narrivoxFolderPicked = (ok) => {
      delete target.__narrivoxFolderPicked;
      delete target.__narrivoxFolderProgress;
      resolve(ok);
    };
    native.pickBookFolder();
  });
  if (!picked) return { ok: false, cancelled: true, error: "" };
  try {
    const count = native.folderAudioCount();
    const folderName = native.folderName();
    const files: File[] = [];
    const chunk = 128 * 1024;
    for (let index = 0; index < count; index += 1) {
      onProgress(`Copying ${index + 1} of ${count}…`);
      const name = native.folderAudioName(index);
      const size = Number(native.folderAudioSize(index));
      const parts: ArrayBuffer[] = [];
      for (let offset = 0; offset < size; offset += chunk) {
        const encoded = native.folderAudioChunk(index, offset, Math.min(chunk, size - offset));
        if (!encoded) return { ok: false, cancelled: false, error: "That folder couldn't be read." };
        parts.push(bytesFromBase64(encoded));
      }
      files.push(new File(parts, name, { type: mimeFor(name) }));
    }
    return { ok: true, folderName, files };
  } finally {
    native.releaseFolderImport();
  }
}

async function readBrowserFolder(): Promise<PickedFolder> {
  const picker = (
    window as unknown as {
      showDirectoryPicker?: (options: { mode: "read" }) => Promise<DirectoryHandle>;
    }
  ).showDirectoryPicker;
  if (!picker) return { ok: false, cancelled: false, error: "This browser can't choose a folder." };
  try {
    const directory = await picker({ mode: "read" });
    const files: File[] = [];
    for await (const [, handle] of directory.entries()) {
      if (handle.kind !== "file") continue;
      const file = await handle.getFile();
      if (isAudio(file)) files.push(file);
    }
    return { ok: true, folderName: directory.name, files };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, cancelled: true, error: "" };
    }
    if (error instanceof DOMException && (error.name === "SecurityError" || error.name === "NotAllowedError")) {
      return { ok: false, cancelled: false, error: "", useInput: true };
    }
    return { ok: false, cancelled: false, error: "That folder couldn't be opened." };
  }
}

export function directAudioFromInput(files: File[]) {
  const folderName = folderNameFromRelative(files[0]?.webkitRelativePath ?? "");
  const direct = files.filter((file) => isDirectFolderFile(file.webkitRelativePath || "") && isAudio(file));
  return { folderName, files: direct };
}

export async function pickBookFolder(onProgress: (message: string) => void): Promise<PickedFolder> {
  if (nativeFolder()) return readNativeFolder(onProgress);
  return readBrowserFolder();
}
