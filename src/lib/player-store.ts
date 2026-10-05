import { create } from "zustand";
import { persistConfig } from "@/lib/app-vault";
import { getAudio, markUserPause } from "@/lib/audio-bus";
import { getAudioUrl, optionalAudioUrl, peekAudioUrl, prepareDurableLibrary } from "@/lib/library-db";
import type {
  ActiveBook,
  Bookmark,
  Chapter,
  ProgressEntry,
  Screen,
  ShelfBook,
  SleepState,
} from "@/lib/types";

export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export type Rate = (typeof RATES)[number];

const STORAGE_KEY = "nightstand.v1";

type Stored = {
  progress?: Record<string, ProgressEntry>;
  bookmarks?: Bookmark[];
  durations?: Record<string, number>;
  rate?: number;
  volume?: number;
};

type PlayerState = {
  hydrated: boolean;
  screen: Screen;
  returnTo: "shelf" | "book";
  bookId: string | null;
  active: ActiveBook | null;
  playing: boolean;
  buffering: boolean;
  currentTime: number;
  duration: number;
  error: string | null;
  rate: Rate;
  volume: number;
  sleep: SleepState;
  progress: Record<string, ProgressEntry>;
  bookmarks: Bookmark[];
  durations: Record<string, number>;
  openBook: (id: string) => void;
  closeBook: () => void;
  openPlayer: () => void;
  closePlayer: () => void;
  play: (book: ShelfBook, chapterId: string, autoplay: boolean, at?: number) => Promise<void>;
  replay: (book: ShelfBook) => Promise<void>;
  toggle: () => Promise<void>;
  seek: (time: number) => void;
  skip: (delta: number) => void;
  stepChapter: (dir: -1 | 1) => Promise<boolean>;
  setRate: (rate: Rate) => void;
  setVolume: (volume: number) => void;
  setSleep: (choice: "off" | 15 | 30 | 45 | "chapter") => void;
  clearSleep: () => void;
  toggleBookmark: () => "saved" | "removed";
  removeBookmark: (id: string) => void;
  forgetBook: (bookId: string) => void;
  setClock: (time: number, duration: number) => void;
  setPlaying: (playing: boolean) => void;
  setBuffering: (buffering: boolean) => void;
  setError: (error: string | null) => void;
  markChapterDone: () => void;
  rememberDuration: (bookId: string, chapterId: string, duration: number) => void;
};

let loadToken = 0;
let rewindToken = 0;
let sourceLoading = false;

function isRate(value: unknown): value is Rate {
  return typeof value === "number" && (RATES as readonly number[]).includes(value);
}

function writeStorage(state: PlayerState) {
  if (typeof localStorage === "undefined") return;
  const payload: Stored = {
    progress: state.progress,
    bookmarks: state.bookmarks,
    durations: state.durations,
    rate: state.rate,
    volume: state.volume,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  persistConfig();
}

function isProgress(value: unknown): value is ProgressEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as ProgressEntry;
  return typeof entry.chapterId === "string" && entry.times !== null && typeof entry.times === "object";
}

function isBookmark(value: unknown): value is Bookmark {
  if (!value || typeof value !== "object") return false;
  const mark = value as Bookmark;
  return (
    typeof mark.id === "string" &&
    typeof mark.bookId === "string" &&
    typeof mark.chapterId === "string" &&
    typeof mark.time === "number"
  );
}

async function loadSource(
  book: ActiveBook,
  chapter: Chapter,
  time: number,
  autoplay: boolean,
) {
  const audio = getAudio();
  if (!audio) return;
  const token = ++loadToken;
  sourceLoading = true;
  const store = usePlayer.getState();
  store.setError(null);
  usePlayer.getState().setBuffering(true);
  try {
    const local = peekAudioUrl(book.bookId, chapter.id) ?? (await optionalAudioUrl(book.bookId, chapter.id));
    const src = local ?? chapter.src ?? (await getAudioUrl(book.bookId, chapter.id));
    if (token !== loadToken) return;
    audio.preservesPitch = true;
    audio.playbackRate = usePlayer.getState().rate;
    audio.volume = usePlayer.getState().volume;
    const absolute = new URL(src, window.location.href).href;
    if (audio.src !== absolute) audio.src = src;
    const seekTo = () => {
      if (token !== loadToken) return;
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      let nextTime = Math.max(0, time);
      if (duration > 1 && nextTime >= duration - 0.75) nextTime = 0;
      else if (duration > 0.4) nextTime = Math.min(nextTime, duration - 0.2);
      if (duration > 0 && Math.abs(audio.currentTime - nextTime) > 0.3) audio.currentTime = nextTime;
      usePlayer.getState().setClock(audio.currentTime || nextTime, audio.duration);
    };
    if (audio.readyState >= 1) seekTo();
    else if (time > 0.05) audio.addEventListener("loadedmetadata", seekTo, { once: true });
    if (autoplay) await audio.play();
    else usePlayer.getState().setPlaying(false);
    usePlayer.getState().setBuffering(false);
    if (audio.readyState >= 1) seekTo();
  } catch (error) {
    if (token !== loadToken) return;
    const name = error instanceof DOMException ? error.name : "";
    if (name === "AbortError" || (error instanceof Error && error.message === "stale")) return;
    usePlayer.getState().setBuffering(false);
    usePlayer.getState().setPlaying(false);
    if (name === "NotAllowedError") {
      usePlayer.getState().setError("Tap play to start listening.");
      return;
    }
    usePlayer.getState().setError("This chapter couldn't be played.");
  } finally {
    if (token === loadToken) sourceLoading = false;
  }
}

function blankEntry(chapterId: string): ProgressEntry {
  return { chapterId, times: {}, done: [], finished: false, updatedAt: Date.now() };
}

export const usePlayer = create<PlayerState>((set, get) => ({
  hydrated: false,
  screen: "shelf",
  returnTo: "shelf",
  bookId: null,
  active: null,
  playing: false,
  buffering: false,
  currentTime: 0,
  duration: 0,
  error: null,
  rate: 1,
  volume: 1,
  sleep: { mode: "off" },
  progress: {},
  bookmarks: [],
  durations: {},

  openBook: (id) => set({ screen: "book", bookId: id }),
  closeBook: () => set({ screen: "shelf" }),
  openPlayer: () => {
    const screen = get().screen;
    if (screen === "now") return;
    set({ screen: "now", returnTo: screen === "book" ? "book" : "shelf" });
  },
  closePlayer: () => set({ screen: get().returnTo === "book" ? "book" : "shelf" }),

  play: async (book, chapterId, autoplay, at) => {
    let chapter = book.chapters.find((item) => item.id === chapterId) ?? book.chapters[0];
    if (!chapter) return;
    const previous = get().progress[book.id];
    const known = get().durations[`${book.id}:${chapter.id}`] ?? 0;
    let time = at ?? previous?.times[chapter.id] ?? 0;
    // A save parked on the last instant used to end the chapter immediately.
    if (at == null && known > 1 && time >= known - 0.75) time = 0;
    const active: ActiveBook = {
      bookId: book.id,
      title: book.title,
      author: book.author,
      cover: book.cover,
      narrator: book.narrator,
      chapters: book.chapters,
      chapterId: chapter.id,
    };
    const entry: ProgressEntry = {
      chapterId: chapter.id,
      times: { ...(previous?.times ?? {}), [chapter.id]: time },
      done: previous?.done ?? [],
      finished: false,
      updatedAt: Date.now(),
    };
    const progress = { ...get().progress, [book.id]: entry };
    set({
      active,
      progress,
      error: null,
      currentTime: time,
      duration: get().durations[`${book.id}:${chapter.id}`] ?? 0,
    });
    writeStorage(get());
    await loadSource(active, chapter, time, autoplay);
  },

  replay: async (book) => {
    const first = book.chapters[0];
    if (!first) return;
    const progress = { ...get().progress };
    delete progress[book.id];
    set({ progress });
    writeStorage(get());
    await get().play(book, first.id, true, 0);
  },

  toggle: async () => {
    const audio = getAudio();
    const active = get().active;
    if (!audio || !active) return;
    if (audio.paused) {
      if (Number.isFinite(audio.duration) && audio.currentTime >= audio.duration - 0.3) {
        audio.currentTime = 0;
      }
      try {
        await audio.play();
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          set({ error: "Tap play to start listening.", playing: false });
        }
      }
      return;
    }
    markUserPause();
    audio.pause();
  },

  seek: (time) => {
    const audio = getAudio();
    let next = Math.max(0, time);
    if (audio && Number.isFinite(audio.duration)) {
      next = Math.min(next, audio.duration);
      audio.currentTime = next;
    }
    const previous = get().currentTime;
    set({ currentTime: next });
    if (Math.floor(previous) !== Math.floor(next)) commitTime(next);
  },

  skip: (delta) => {
    const audio = getAudio();
    const base = audio ? audio.currentTime : get().currentTime;
    if (delta < 0 && base + delta < -0.05) {
      void rewindChapters(-delta);
      return;
    }
    const duration = audio && Number.isFinite(audio.duration) ? audio.duration : Infinity;
    const next = Math.min(Math.max(0, base + delta), duration === Infinity ? base + delta : Math.max(0, duration));
    if (audio) audio.currentTime = next;
    set({ currentTime: next });
    commitTime(next);
  },

  stepChapter: async (dir) => {
    const active = get().active;
    if (!active) return false;
    const index = active.chapters.findIndex((chapter) => chapter.id === active.chapterId);
    const chapter = active.chapters[index + dir];
    if (!chapter) return false;
    const entry = get().progress[active.bookId];
    const known = get().durations[`${active.bookId}:${chapter.id}`] ?? 0;
    let time = entry?.times[chapter.id] ?? 0;
    if (known > 1 && time >= known - 0.75) time = 0;
    const nextActive: ActiveBook = { ...active, chapterId: chapter.id };
    const progress = {
      ...get().progress,
      [active.bookId]: {
        chapterId: chapter.id,
        times: entry?.times ?? {},
        done: entry?.done ?? [],
        finished: false,
        updatedAt: Date.now(),
      },
    };
    set({
      active: nextActive,
      progress,
      currentTime: time,
      duration: get().durations[`${active.bookId}:${chapter.id}`] ?? 0,
      error: null,
    });
    writeStorage(get());
    await loadSource(nextActive, chapter, time, true);
    return true;
  },

  setRate: (rate) => {
    set({ rate });
    const audio = getAudio();
    if (audio) {
      audio.preservesPitch = true;
      audio.playbackRate = rate;
    }
    writeStorage(get());
  },

  setVolume: (volume) => {
    const next = Math.min(1, Math.max(0, volume));
    set({ volume: next });
    const audio = getAudio();
    if (audio) audio.volume = next;
    writeStorage(get());
  },

  setSleep: (choice) => {
    if (choice === "off") set({ sleep: { mode: "off" } });
    else if (choice === "chapter") set({ sleep: { mode: "chapter" } });
    else set({ sleep: { mode: "minutes", minutes: choice, endsAt: Date.now() + choice * 60_000 } });
  },

  clearSleep: () => set({ sleep: { mode: "off" } }),

  toggleBookmark: () => {
    const active = get().active;
    if (!active) return "removed";
    const time = get().currentTime;
    const existing = get().bookmarks.find(
      (mark) =>
        mark.bookId === active.bookId &&
        mark.chapterId === active.chapterId &&
        Math.abs(mark.time - time) < 2,
    );
    if (existing) {
      set({ bookmarks: get().bookmarks.filter((mark) => mark.id !== existing.id) });
      writeStorage(get());
      return "removed";
    }
    const bookmark: Bookmark = {
      id: crypto.randomUUID(),
      bookId: active.bookId,
      chapterId: active.chapterId,
      time,
      createdAt: Date.now(),
    };
    set({ bookmarks: [bookmark, ...get().bookmarks] });
    writeStorage(get());
    return "saved";
  },

  removeBookmark: (id) => {
    set({ bookmarks: get().bookmarks.filter((mark) => mark.id !== id) });
    writeStorage(get());
  },

  forgetBook: (bookId) => {
    const progress = { ...get().progress };
    delete progress[bookId];
    const durations = { ...get().durations };
    for (const key of Object.keys(durations)) {
      if (key.startsWith(`${bookId}:`)) delete durations[key];
    }
    const clearing = get().active?.bookId === bookId;
    if (clearing) {
      loadToken += 1;
      markUserPause();
      getAudio()?.pause();
    }
    set({
      progress,
      durations,
      bookmarks: get().bookmarks.filter((mark) => mark.bookId !== bookId),
      ...(clearing
        ? {
            active: null,
            playing: false,
            buffering: false,
            screen: "shelf" as const,
            currentTime: 0,
            duration: 0,
          }
        : {}),
    });
    writeStorage(get());
  },

  setClock: (time, duration) => {
    if (sourceLoading) return;
    const audio = getAudio();
    if (audio?.ended) return;
    const nextDuration = Number.isFinite(duration) ? duration : 0;
    const previous = get().currentTime;
    set({ currentTime: time, duration: nextDuration });
    const active = get().active;
    if (active && nextDuration > 0) get().rememberDuration(active.bookId, active.chapterId, nextDuration);
    if (Math.floor(previous) !== Math.floor(time)) commitTime(time);
  },

  setPlaying: (playing) => set({ playing }),
  setBuffering: (buffering) => set({ buffering }),
  setError: (error) => set({ error }),

  markChapterDone: () => {
    const active = get().active;
    if (!active) return;
    const entry = get().progress[active.bookId] ?? blankEntry(active.chapterId);
    const done = entry.done.includes(active.chapterId) ? entry.done : [...entry.done, active.chapterId];
    const times = { ...entry.times };
    if (get().duration > 0) times[active.chapterId] = get().duration;
    const finished = active.chapters.every((chapter) => done.includes(chapter.id));
    const progress = {
      ...get().progress,
      [active.bookId]: {
        ...entry,
        chapterId: active.chapterId,
        times,
        done,
        finished,
        updatedAt: Date.now(),
      },
    };
    set({ progress });
    writeStorage(get());
  },

  rememberDuration: (bookId, chapterId, duration) => {
    if (!Number.isFinite(duration) || duration <= 0) return;
    const key = `${bookId}:${chapterId}`;
    const previous = get().durations[key];
    if (previous && Math.abs(previous - duration) < 0.25) return;
    const durations = { ...get().durations, [key]: duration };
    set({ durations });
    writeStorage(get());
  },
}));

function commitTime(time: number) {
  const active = usePlayer.getState().active;
  if (!active) return;
  stampChapterTime(active.bookId, active.chapterId, time);
}

function stampChapterTime(bookId: string, chapterId: string, time: number) {
  const state = usePlayer.getState();
  const entry = state.progress[bookId] ?? blankEntry(chapterId);
  const progress = {
    ...state.progress,
    [bookId]: {
      ...entry,
      times: { ...entry.times, [chapterId]: time },
      updatedAt: Date.now(),
    },
  };
  usePlayer.setState({ progress });
  writeStorage(usePlayer.getState());
}

async function chapterSource(book: ActiveBook, chapter: Chapter) {
  const local = peekAudioUrl(book.bookId, chapter.id) ?? (await optionalAudioUrl(book.bookId, chapter.id));
  return local ?? chapter.src ?? (await getAudioUrl(book.bookId, chapter.id));
}

async function probeDuration(book: ActiveBook, chapter: Chapter) {
  const known = usePlayer.getState().durations[`${book.bookId}:${chapter.id}`];
  if (known && known > 0.3) return known;
  const src = await chapterSource(book, chapter);
  const duration = await new Promise<number>((resolve) => {
    const probe = new Audio();
    probe.preload = "metadata";
    const finish = (value: number) => {
      probe.removeAttribute("src");
      probe.load();
      resolve(value);
    };
    probe.addEventListener(
      "loadedmetadata",
      () => finish(Number.isFinite(probe.duration) ? probe.duration : 0),
      { once: true },
    );
    probe.addEventListener("error", () => finish(0), { once: true });
    probe.src = src;
  });
  if (duration > 0.3) usePlayer.getState().rememberDuration(book.bookId, chapter.id, duration);
  return duration;
}

async function rewindChapters(seconds: number) {
  const token = ++rewindToken;
  const audio = getAudio();
  const active = usePlayer.getState().active;
  if (!active) return;
  const base = audio ? audio.currentTime : usePlayer.getState().currentTime;
  const autoplay = audio ? !audio.paused : usePlayer.getState().playing;
  let index = active.chapters.findIndex((chapter) => chapter.id === active.chapterId);
  if (index <= 0) {
    if (audio) audio.currentTime = 0;
    usePlayer.setState({ currentTime: 0 });
    commitTime(0);
    return;
  }
  stampChapterTime(active.bookId, active.chapterId, 0);
  let leftover = seconds - Math.max(0, base);
  while (index > 0 && token === rewindToken) {
    index -= 1;
    const chapter = active.chapters[index];
    if (!chapter) return;
    let duration = 0;
    try {
      duration = await probeDuration(active, chapter);
    } catch {
      duration = 0;
    }
    if (token !== rewindToken) return;
    if (duration <= 0) {
      const nextActive: ActiveBook = { ...active, chapterId: chapter.id };
      usePlayer.setState({
        active: nextActive,
        currentTime: 0,
        duration: 0,
        error: null,
      });
      await loadSource(nextActive, chapter, 0, autoplay);
      return;
    }
    if (duration >= leftover) {
      const at = duration - leftover;
      const nextActive: ActiveBook = { ...active, chapterId: chapter.id };
      const entry = usePlayer.getState().progress[active.bookId];
      usePlayer.setState({
        active: nextActive,
        progress: {
          ...usePlayer.getState().progress,
          [active.bookId]: {
            chapterId: chapter.id,
            times: { ...(entry?.times ?? {}), [chapter.id]: at },
            done: entry?.done ?? [],
            finished: false,
            updatedAt: Date.now(),
          },
        },
        currentTime: at,
        duration,
        error: null,
      });
      writeStorage(usePlayer.getState());
      await loadSource(nextActive, chapter, at, autoplay);
      return;
    }
    stampChapterTime(active.bookId, chapter.id, 0);
    leftover -= duration;
  }
  const first = active.chapters[0];
  if (!first || token !== rewindToken) return;
  const nextActive: ActiveBook = { ...active, chapterId: first.id };
  const entry = usePlayer.getState().progress[active.bookId];
  usePlayer.setState({
    active: nextActive,
    progress: {
      ...usePlayer.getState().progress,
      [active.bookId]: {
        chapterId: first.id,
        times: { ...(entry?.times ?? {}), [first.id]: 0 },
        done: entry?.done ?? [],
        finished: false,
        updatedAt: Date.now(),
      },
    },
    currentTime: 0,
    duration: usePlayer.getState().durations[`${active.bookId}:${first.id}`] ?? 0,
    error: null,
  });
  writeStorage(usePlayer.getState());
  await loadSource(nextActive, first, 0, autoplay);
}

export function hydratePlayer() {
  if (usePlayer.getState().hydrated) return;
  void prepareDurableLibrary().then(() => {
    if (usePlayer.getState().hydrated) return;
    applyHydratedPlayer();
  });
}

function applyHydratedPlayer() {
  if (usePlayer.getState().hydrated) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as Stored;
      const progress: Record<string, ProgressEntry> = {};
      if (data.progress && typeof data.progress === "object") {
        for (const [id, entry] of Object.entries(data.progress)) {
          if (isProgress(entry)) {
            progress[id] = {
              chapterId: entry.chapterId,
              times: entry.times ?? {},
              done: Array.isArray(entry.done) ? entry.done.filter((item) => typeof item === "string") : [],
              finished: Boolean(entry.finished),
              updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : 0,
            };
          }
        }
      }
      const durations: Record<string, number> = {};
      if (data.durations && typeof data.durations === "object") {
        for (const [key, value] of Object.entries(data.durations)) {
          if (typeof value === "number" && Number.isFinite(value)) durations[key] = value;
        }
      }
      usePlayer.setState({
        progress,
        bookmarks: Array.isArray(data.bookmarks) ? data.bookmarks.filter(isBookmark) : [],
        durations,
        rate: isRate(data.rate) ? data.rate : 1,
        volume: typeof data.volume === "number" ? Math.min(1, Math.max(0, data.volume)) : 1,
      });
    }
  } catch {
    // Ignore a damaged save and start fresh.
  }
  usePlayer.setState({ hydrated: true });
  const audio = getAudio();
  if (audio) {
    audio.volume = usePlayer.getState().volume;
    audio.preservesPitch = true;
    audio.playbackRate = usePlayer.getState().rate;
  }
}
