// @ts-nocheck
import { useEffect, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import {
  ArrowLeft,
  Bookmark,
  BookOpen,
  Check,
  Pause,
  Play,
  Plus,
  Search,
  SkipBack,
  SkipForward,
  Timer,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { AudioEngine } from "@/components/audio-engine";
import { AddBookDialog } from "@/components/add-book-dialog";
import { CoverArt } from "@/components/cover";
import { BOOKS } from "@/lib/catalog";
import { formatRate, formatTime } from "@/lib/format";
import {
  catalogBytes,
  formatBytes,
  getDownloadStatus,
  refreshSaved,
  startFullDownload,
  subscribeDownload,
} from "@/lib/full-book";
import { deleteUserBook, listUserBooks } from "@/lib/library-db";
import { hydratePlayer, RATES, usePlayer } from "@/lib/player-store";
import { loadPublicRecording, savePublicBook, searchPublicDomain } from "@/lib/public-search";
import { findShelf, fromUser, libraryShelf, listenedFraction } from "@/lib/shelf";

function PlayPauseIcon({ playing }) {
  return /* @__PURE__ */ jsxs("span", {
    className: "grid h-6 w-6",
    children: [
      /* @__PURE__ */ jsx(Pause, {
        className: "icon-swap h-6 w-6",
        "data-on": playing ? "true" : "false",
      }),
      /* @__PURE__ */ jsx(Play, {
        className: "icon-swap h-6 w-6",
        "data-on": playing ? "false" : "true",
      }),
    ],
  });
}
function useUserBooks() {
  const [books, setBooks] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const refresh = async () => {
    try {
      setBooks(await listUserBooks());
    } finally {
      setLoaded(true);
    }
  };
  useEffect(() => {
    let live = true;
    listUserBooks()
      .then((all) => {
        if (live) setBooks(all);
      })
      .catch(() => void 0)
      .finally(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, []);
  return {
    books,
    loaded,
    refresh,
  };
}
function resume(book, entry) {
  const chapterId = entry?.chapterId ?? book.chapters[0]?.id;
  if (!chapterId) return;
  if (book.source === "library") startFullDownload(book.id);
  usePlayer
    .getState()
    .play(book, chapterId, true)
    .then(() => usePlayer.getState().openPlayer());
}
export function Narrivox() {
  const screen = usePlayer((state) => state.screen);
  const hasActive = usePlayer((state) => state.active !== null);
  const { books, refresh } = useUserBooks();
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    hydratePlayer();
    for (const book of BOOKS)
      for (const chapter of book.chapters) {
        if (usePlayer.getState().durations[`${book.id}:${chapter.id}`])
          continue;
        const probe = new Audio();
        probe.preload = "metadata";
        probe.addEventListener(
          "loadedmetadata",
          () => {
            usePlayer
              .getState()
              .rememberDuration(book.id, chapter.id, probe.duration);
            probe.removeAttribute("src");
            probe.load();
          },
          { once: true },
        );
        probe.src = chapter.src;
      }
  }, []);
  useEffect(() => {
    const onKey = (event) => {
      if (
        event.target?.closest(
          "input, textarea, select, [contenteditable='true'], [role='dialog']",
        )
      )
        return;
      const store = usePlayer.getState();
      if (!store.active) return;
      if (event.key === " " || event.key === "k") {
        event.preventDefault();
        store.toggle();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (event.shiftKey) store.stepChapter(-1);
        else store.skip(-15);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (event.shiftKey) store.stepChapter(1);
        else store.skip(30);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return /* @__PURE__ */ jsxs(Fragment, {
    children: [
      /* @__PURE__ */ jsx(AudioEngine, {}),
      /* @__PURE__ */ jsxs("div", {
        className: hasActive && screen !== "now" ? "pb-28" : void 0,
        children: [
          screen === "shelf" &&
            /* @__PURE__ */ jsx(Shelf, {
              userBooks: books,
              onAdd: () => setAdding(true),
            }),
          screen === "book" &&
            /* @__PURE__ */ jsx(BookScreen, {
              userBooks: books,
              onRemove: async (book) => {
                usePlayer.getState().forgetBook(book.id);
                await deleteUserBook(book);
                await refresh();
              },
            }),
          screen === "now" && /* @__PURE__ */ jsx(NowPlaying, {}),
        ],
      }),
      hasActive && screen !== "now" && /* @__PURE__ */ jsx(MiniPlayer, {}),
      /* @__PURE__ */ jsx(AddBookDialog, {
        open: adding,
        onOpenChange: setAdding,
        onSaved: () => void refresh(),
      }),
    ],
  });
}
function Shelf({ userBooks, onAdd }) {
  const progress = usePlayer((state) => state.progress);
  const [savingApk, setSavingApk] = useState(false);
  async function downloadApk() {
    setSavingApk(true);
    try {
      const response = await fetch("/Narrivox.apk");
      if (!response.ok) return;
      const bytes = await response.arrayBuffer();
      const file = new File([bytes], "Narrivox.apk", {
        type: "application/vnd.android.package-archive",
      });
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = "Narrivox.apk";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } finally {
      setSavingApk(false);
    }
  }
  const durations = usePlayer((state) => state.durations);
  const hydrated = usePlayer((state) => state.hydrated);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [opening, setOpening] = useState(null);
  const yours = userBooks.map(fromUser);
  const library = libraryShelf();
  const q = query.trim().toLowerCase();
  const results = q
    ? [...yours, ...library].filter((book) => {
        const chapters = book.chapters.map((chapter) => chapter.title).join(" ");
        return `${book.title} ${book.author} ${chapters}`.toLowerCase().includes(q);
      })
    : [];
  useEffect(() => {
    if (q.length < 2) {
      setRemote([]);
      setSearching(false);
      setSearchError("");
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    setSearchError("");
    const timer = window.setTimeout(() => {
      searchPublicDomain(q, controller.signal)
        .then((hits) => {
          if (!controller.signal.aborted) setRemote(hits);
        })
        .catch((error) => {
          if (controller.signal.aborted || error?.name === "AbortError") return;
          setRemote([]);
          setSearchError("The public-domain catalog didn't answer. Your shelf is still searched.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 400);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [q]);
  async function openHit(hit) {
    setOpening(hit.identifier);
    setSearchError("");
    try {
      const book = await loadPublicRecording(hit);
      savePublicBook(book);
      usePlayer.getState().openBook(book.id);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "That recording couldn't be opened.");
      setOpening(null);
    }
  }
  const recent = [...yours, ...library]
    .map((book) => ({
      book,
      entry: progress[book.id],
    }))
    .filter(
      (item) =>
        Boolean(item.entry) && !item.entry.finished && item.entry.updatedAt > 0,
    )
    .sort((a, b) => b.entry.updatedAt - a.entry.updatedAt);
  return /* @__PURE__ */ jsxs("main", {
    className: "mx-auto max-w-5xl px-5 pb-20",
    children: [
      /* @__PURE__ */ jsxs("header", {
        className: "topbar -mx-5 mb-6 px-5 py-4",
        children: [
          /* @__PURE__ */ jsxs("div", {
            className: "flex flex-wrap items-center justify-between gap-3",
            children: [
              /* @__PURE__ */ jsxs("div", {
                children: [
                  /* @__PURE__ */ jsxs("div", {
                    className: "flex items-center gap-2",
                    children: [
                      /* @__PURE__ */ jsx("span", {
                        className: "lamp",
                        "aria-hidden": true,
                      }),
                      /* @__PURE__ */ jsx("h1", {
                        className: "text-2xl",
                        children: "Narrivox",
                      }),
                    ],
                  }),
                  /* @__PURE__ */ jsx("p", {
                    className: "mt-1 text-sm text-muted",
                    children: "Stories for the last hour of the day.",
                  }),
                ],
              }),
              /* @__PURE__ */ jsxs("div", {
                className: "flex shrink-0 items-center gap-2",
                children: [
                  /* @__PURE__ */ jsx("button", {
                    type: "button",
                    className: "btn btn-quiet shrink-0",
                    onClick: () => void downloadApk(),
                    disabled: savingApk,
                    children: savingApk ? "Saving…" : "Download APK",
                  }),
                  /* @__PURE__ */ jsxs("button", {
                    type: "button",
                    className: "btn btn-primary shrink-0",
                    onClick: onAdd,
                    children: [
                      /* @__PURE__ */ jsx(Plus, { className: "h-4 w-4" }),
                      "Add",
                    ],
                  }),
                ],
              }),
            ],
          }),
          /* @__PURE__ */ jsxs("label", {
            className: "relative mt-4 block",
            children: [
              /* @__PURE__ */ jsx("span", {
                className: "sr-only",
                children: "Search the shelf",
              }),
              /* @__PURE__ */ jsx(Search, {
                className:
                  "pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted",
              }),
              /* @__PURE__ */ jsx("input", {
                className: "field search-field",
                value: query,
                placeholder: "Search your shelf or the public domain",
                onChange: (event) => setQuery(event.target.value),
                suppressHydrationWarning: true,
              }),
            ],
          }),
        ],
      }),
      q
        ? /* @__PURE__ */ jsxs("section", {
            children: [
              /* @__PURE__ */ jsx("h2", {
                className: "text-xl",
                children: "On this shelf",
              }),
              results.length === 0
                ? /* @__PURE__ */ jsx("p", {
                    className: "mt-3 text-sm text-muted",
                    children: "Nothing in your library matches.",
                  })
                : /* @__PURE__ */ jsx(BookGrid, {
                    books: results,
                    progress,
                    durations,
                  }),
              /* @__PURE__ */ jsx("h2", {
                className: "mt-8 text-xl",
                children: "Public domain",
              }),
              /* @__PURE__ */ jsx("p", {
                className: "mt-1 text-sm text-muted",
                children: "LibriVox recordings, alongside the books already on this shelf.",
              }),
              searching &&
                /* @__PURE__ */ jsx("p", {
                  className: "mt-3 text-sm text-muted",
                  children: "Searching the public domain…",
                }),
              searchError &&
                /* @__PURE__ */ jsx("p", {
                  className: "mt-3 text-sm text-primary",
                  role: "alert",
                  children: searchError,
                }),
              !searching && remote.length === 0 && q.length >= 2 && !searchError &&
                /* @__PURE__ */ jsx("p", {
                  className: "mt-3 text-sm text-muted",
                  children: "No public-domain recording matches that.",
                }),
              q.length < 2 &&
                /* @__PURE__ */ jsx("p", {
                  className: "mt-3 text-sm text-muted",
                  children: "Type two more letters to search LibriVox.",
                }),
              /* @__PURE__ */ jsx("ul", {
                className: "mt-3",
                children: remote.map((hit) =>
                  /* @__PURE__ */ jsx(
                    "li",
                    {
                      children: /* @__PURE__ */ jsxs("button", {
                        type: "button",
                        className: "chapter-row",
                        disabled: opening === hit.identifier,
                        onClick: () => void openHit(hit),
                        children: [
                          /* @__PURE__ */ jsx("span", {
                            className: "w-12 shrink-0",
                            children: /* @__PURE__ */ jsx(CoverArt, {
                              title: hit.title,
                              src: hit.cover,
                            }),
                          }),
                          /* @__PURE__ */ jsxs("span", {
                            className: "min-w-0 flex-1",
                            children: [
                              /* @__PURE__ */ jsx("span", {
                                className: "block truncate font-display",
                                children: hit.title,
                              }),
                              /* @__PURE__ */ jsx("span", {
                                className: "block truncate text-sm text-muted",
                                children:
                                  opening === hit.identifier
                                    ? "Opening the recording…"
                                    : `${hit.author} · LibriVox`,
                              }),
                            ],
                          }),
                        ],
                      }),
                    },
                    hit.identifier,
                  ),
                ),
              }),
            ],
          })
        : /* @__PURE__ */ jsxs(Fragment, {
            children: [
              hydrated &&
                recent[0] &&
                /* @__PURE__ */ jsxs("section", {
                  className: "mb-8",
                  children: [
                    /* @__PURE__ */ jsx(ContinueCard, {
                      book: recent[0].book,
                      entry: recent[0].entry,
                      durations,
                    }),
                    recent.length > 1 &&
                      /* @__PURE__ */ jsx("div", {
                        className: "mt-3 flex gap-3 overflow-x-auto pb-1",
                        children: recent.slice(1).map(({ book }) =>
                          /* @__PURE__ */ jsxs(
                            "button",
                            {
                              type: "button",
                              className: "w-16 shrink-0 text-left",
                              onClick: () =>
                                usePlayer.getState().openBook(book.id),
                              children: [
                                /* @__PURE__ */ jsx(CoverArt, {
                                  title: book.title,
                                  src: book.cover,
                                }),
                                /* @__PURE__ */ jsx("span", {
                                  className: "sr-only",
                                  children: book.title,
                                }),
                              ],
                            },
                            book.id,
                          ),
                        ),
                      }),
                  ],
                }),
              /* @__PURE__ */ jsxs("section", {
                className: "mb-10",
                children: [
                  /* @__PURE__ */ jsx("h2", {
                    className: "text-xl",
                    children: "Your copies",
                  }),
                  /* @__PURE__ */ jsx("p", {
                    className: "mt-1 text-sm text-muted",
                    children: "Audio you add stays on this device.",
                  }),
                  yours.length === 0 &&
                    /* @__PURE__ */ jsxs("button", {
                      type: "button",
                      className: "dashed-card mt-4 w-full px-4 py-6 text-left",
                      onClick: onAdd,
                      children: [
                        /* @__PURE__ */ jsx("span", {
                          className: "font-display text-lg",
                          children: "Nothing of yours yet.",
                        }),
                        /* @__PURE__ */ jsx("span", {
                          className: "mt-1 block text-sm text-muted",
                          children:
                            "Add an mp3 you already own. Chapters play in the order you choose.",
                        }),
                      ],
                    }),
                  yours.length > 0 &&
                    /* @__PURE__ */ jsx(BookGrid, {
                      books: yours,
                      progress,
                      durations,
                    }),
                ],
              }),
              /* @__PURE__ */ jsxs("section", {
                children: [
                  /* @__PURE__ */ jsx("h2", {
                    className: "text-xl",
                    children: "From the public domain",
                  }),
                  /* @__PURE__ */ jsx("p", {
                    className: "mt-1 text-sm text-muted",
                    children:
                      "Full public-domain recordings from LibriVox. Playing one saves the whole book on this device.",
                  }),
                  /* @__PURE__ */ jsx(BookGrid, {
                    books: library,
                    progress,
                    durations,
                  }),
                ],
              }),
            ],
          }),
    ],
  });
}
function BookGrid({ books, progress, durations }) {
  return /* @__PURE__ */ jsx("ul", {
    className:
      "mt-4 grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4",
    children: books.map((book) => {
      const fraction = listenedFraction(book, progress[book.id], durations);
      const finished = progress[book.id]?.finished;
      return /* @__PURE__ */ jsx(
        "li",
        {
          children: /* @__PURE__ */ jsxs("button", {
            type: "button",
            className: "w-full text-left",
            onClick: () => usePlayer.getState().openBook(book.id),
            children: [
              /* @__PURE__ */ jsx(CoverArt, {
                title: book.title,
                src: book.cover,
              }),
              /* @__PURE__ */ jsx("span", {
                className: "mt-2 block font-display text-base leading-snug",
                children: book.title,
              }),
              /* @__PURE__ */ jsx("span", {
                className: "mt-0.5 block text-sm text-muted",
                children: book.author,
              }),
              finished
                ? /* @__PURE__ */ jsx("span", {
                    className: "mt-1 block text-sm text-primary",
                    children: "Finished",
                  })
                : fraction > 0.01 &&
                  /* @__PURE__ */ jsx("span", {
                    className: "bar mt-2 block",
                    "aria-hidden": true,
                    children: /* @__PURE__ */ jsx("span", {
                      style: { width: `${Math.round(fraction * 100)}%` },
                    }),
                  }),
              fraction > 0 &&
                /* @__PURE__ */ jsxs("span", {
                  className: "sr-only",
                  children: [Math.round(fraction * 100), " percent played"],
                }),
            ],
          }),
        },
        book.id,
      );
    }),
  });
}
function ContinueCard({ book, entry, durations }) {
  const chapter =
    book.chapters.find((item) => item.id === entry.chapterId) ??
    book.chapters[0];
  const fraction = listenedFraction(book, entry, durations);
  return /* @__PURE__ */ jsxs("article", {
    className:
      "flex items-center gap-3 rounded-lg border border-border bg-raised p-3",
    children: [
      /* @__PURE__ */ jsx("div", {
        className: "w-16 shrink-0",
        children: /* @__PURE__ */ jsx(CoverArt, {
          title: book.title,
          src: book.cover,
        }),
      }),
      /* @__PURE__ */ jsxs("button", {
        type: "button",
        className: "min-w-0 flex-1 text-left",
        onClick: () => resume(book, entry),
        children: [
          /* @__PURE__ */ jsx("span", {
            className: "text-sm text-muted",
            children: "Continue",
          }),
          /* @__PURE__ */ jsx("span", {
            className: "mt-0.5 block font-display text-lg leading-snug",
            children: book.title,
          }),
          /* @__PURE__ */ jsx("span", {
            className: "block truncate text-sm text-muted",
            children: chapter?.title,
          }),
          /* @__PURE__ */ jsx("span", {
            className: "bar mt-3 block",
            "aria-hidden": true,
            children: /* @__PURE__ */ jsx("span", {
              style: { width: `${Math.round(fraction * 100)}%` },
            }),
          }),
        ],
      }),
      /* @__PURE__ */ jsx("button", {
        type: "button",
        className: "play-btn h-12 w-12 shrink-0",
        "aria-label": `Resume ${book.title}`,
        onClick: () => resume(book, entry),
        children: /* @__PURE__ */ jsx(Play, { className: "h-5 w-5" }),
      }),
    ],
  });
}
function BookScreen({ userBooks, onRemove }) {
  const bookId = usePlayer((state) => state.bookId);
  const progress = usePlayer((state) => state.progress);
  const durations = usePlayer((state) => state.durations);
  const bookmarks = usePlayer((state) => state.bookmarks);
  const activeId = usePlayer((state) => state.active?.bookId);
  const activeChapter = usePlayer((state) => state.active?.chapterId);
  const [confirming, setConfirming] = useState(false);
  const book = bookId ? findShelf(bookId, userBooks) : null;
  const owned = userBooks.find((item) => item.id === bookId);
  if (!book)
    return /* @__PURE__ */ jsxs("main", {
      className: "mx-auto max-w-3xl px-5 py-6",
      children: [
        /* @__PURE__ */ jsxs("button", {
          type: "button",
          className: "btn btn-quiet",
          onClick: () => usePlayer.getState().closeBook(),
          children: [
            /* @__PURE__ */ jsx(ArrowLeft, { className: "h-4 w-4" }),
            "Shelf",
          ],
        }),
        /* @__PURE__ */ jsx("p", {
          className: "mt-6 text-muted",
          children: "That book isn't on the shelf anymore.",
        }),
      ],
    });
  const entry = progress[book.id];
  const marks = bookmarks.filter((mark) => mark.bookId === book.id);
  return /* @__PURE__ */ jsxs("main", {
    className: "mx-auto max-w-3xl px-5 py-5",
    children: [
      /* @__PURE__ */ jsxs("button", {
        type: "button",
        className: "btn btn-quiet",
        onClick: () => usePlayer.getState().closeBook(),
        children: [
          /* @__PURE__ */ jsx(ArrowLeft, { className: "h-4 w-4" }),
          "Shelf",
        ],
      }),
      /* @__PURE__ */ jsxs("div", {
        className: "mt-5 grid gap-6 md:grid-cols-[13rem_1fr] md:items-start",
        children: [
          /* @__PURE__ */ jsx("div", {
            className: "mx-auto w-52 md:mx-0 md:w-full",
            children: /* @__PURE__ */ jsx(CoverArt, {
              title: book.title,
              src: book.cover,
            }),
          }),
          /* @__PURE__ */ jsxs("div", {
            children: [
              /* @__PURE__ */ jsx("h1", {
                className: "text-3xl",
                children: book.title,
              }),
              /* @__PURE__ */ jsxs("p", {
                className: "mt-2 text-muted",
                children: [book.author, book.year ? ` · ${book.year}` : ""],
              }),
              book.narrator &&
                /* @__PURE__ */ jsxs("p", {
                  className: "text-sm text-muted",
                  children: ["Read by ", book.narrator],
                }),
              book.blurb &&
                /* @__PURE__ */ jsx("p", {
                  className: "mt-3 text-pretty",
                  children: book.blurb,
                }),
              /* @__PURE__ */ jsx("div", {
                className: "mt-4",
                children: entry?.finished
                  ? /* @__PURE__ */ jsxs("button", {
                      type: "button",
                      className: "btn btn-primary",
                      onClick: () => void replay(book),
                      children: [
                        /* @__PURE__ */ jsx(Play, { className: "h-4 w-4" }),
                        "Play again",
                      ],
                    })
                  : /* @__PURE__ */ jsxs("button", {
                      type: "button",
                      className: "btn btn-primary",
                      onClick: () => resume(book, entry),
                      children: [
                        /* @__PURE__ */ jsx(Play, { className: "h-4 w-4" }),
                        entry ? "Resume" : "Play",
                      ],
                    }),
              }),
              book.source === "library" &&
                /* @__PURE__ */ jsx(FullDownload, { bookId: book.id }),
            ],
          }),
        ],
      }),
      /* @__PURE__ */ jsx("h2", {
        className: "mt-8 text-xl",
        children: "Chapters",
      }),
      /* @__PURE__ */ jsx("ul", {
        className: "mt-2",
        children: book.chapters.map((chapter, index) => {
          const duration = durations[`${book.id}:${chapter.id}`];
          const time = entry?.times[chapter.id] ?? 0;
          const done = entry?.done.includes(chapter.id);
          const fraction = duration
            ? Math.min(1, (done ? duration : time) / duration)
            : 0;
          const current = activeId === book.id && activeChapter === chapter.id;
          return /* @__PURE__ */ jsx(
            "li",
            {
              children: /* @__PURE__ */ jsxs("button", {
                type: "button",
                className: "chapter-row",
                "data-current": current ? "true" : "false",
                onClick: () => {
                  if (book.source === "library") startFullDownload(book.id);
                  usePlayer
                    .getState()
                    .play(book, chapter.id, true)
                    .then(() => {
                      usePlayer.getState().openPlayer();
                    });
                },
                children: [
                  /* @__PURE__ */ jsx("span", {
                    className: "w-6 shrink-0 text-sm tabular-nums text-muted",
                    children: index + 1,
                  }),
                  /* @__PURE__ */ jsxs("span", {
                    className: "min-w-0 flex-1",
                    children: [
                      /* @__PURE__ */ jsx("span", {
                        className: "block truncate",
                        children: chapter.title,
                      }),
                      fraction > 0.02 &&
                        !done &&
                        /* @__PURE__ */ jsx("span", {
                          className: "bar mt-2 block",
                          "aria-hidden": true,
                          children: /* @__PURE__ */ jsx("span", {
                            style: { width: `${Math.round(fraction * 100)}%` },
                          }),
                        }),
                    ],
                  }),
                  done
                    ? /* @__PURE__ */ jsx(Check, {
                        className: "h-4 w-4 text-primary",
                        "aria-label": "Finished",
                      })
                    : duration &&
                      /* @__PURE__ */ jsx("span", {
                        className: "text-sm tabular-nums text-muted",
                        children: formatTime(duration),
                      }),
                ],
              }),
            },
            chapter.id,
          );
        }),
      }),
      marks.length > 0 &&
        /* @__PURE__ */ jsxs("section", {
          className: "mt-8",
          children: [
            /* @__PURE__ */ jsx("h2", {
              className: "text-xl",
              children: "Bookmarks",
            }),
            /* @__PURE__ */ jsx("ul", {
              className: "mt-2",
              children: marks.map((mark) =>
                /* @__PURE__ */ jsx(
                  BookmarkRow,
                  {
                    book,
                    mark,
                  },
                  mark.id,
                ),
              ),
            }),
          ],
        }),
      owned &&
        /* @__PURE__ */ jsx("div", {
          className: "mt-10",
          children: confirming
            ? /* @__PURE__ */ jsxs("div", {
                className: "flex flex-wrap items-center gap-2",
                children: [
                  /* @__PURE__ */ jsx("p", {
                    className: "text-sm text-muted",
                    children: "Remove this copy from the device?",
                  }),
                  /* @__PURE__ */ jsx("button", {
                    type: "button",
                    className: "btn btn-primary",
                    onClick: () => void onRemove(owned),
                    children: "Remove",
                  }),
                  /* @__PURE__ */ jsx("button", {
                    type: "button",
                    className: "btn btn-quiet",
                    onClick: () => setConfirming(false),
                    children: "Cancel",
                  }),
                ],
              })
            : /* @__PURE__ */ jsx("button", {
                type: "button",
                className: "btn btn-quiet",
                onClick: () => setConfirming(true),
                children: "Remove from this device",
              }),
        }),
    ],
  });
}
function replay(book) {
  if (book.source === "library") startFullDownload(book.id);
  usePlayer
    .getState()
    .replay(book)
    .then(() => usePlayer.getState().openPlayer());
}

function FullDownload({ bookId }) {
  const [status, setStatus] = useState(() => getDownloadStatus(bookId));
  useEffect(() => {
    void refreshSaved(bookId).then(() => setStatus(getDownloadStatus(bookId)));
    return subscribeDownload(bookId, () => setStatus(getDownloadStatus(bookId)));
  }, [bookId]);
  const total = catalogBytes(bookId) || status.total;
  const fraction = total > 0 ? Math.min(1, status.received / total) : 0;
  const label =
    status.phase === "saved"
      ? "Saved on this device"
      : status.phase === "saving"
        ? status.message
        : status.phase === "error"
          ? status.message
          : `Download full book · ${formatBytes(total)}`;
  return /* @__PURE__ */ jsxs("div", {
    className: "mt-4",
    children: [
      /* @__PURE__ */ jsx("button", {
        type: "button",
        className: status.phase === "saved" ? "btn btn-quiet" : "btn btn-primary",
        disabled: status.phase === "saving" || status.phase === "saved",
        onClick: () => startFullDownload(bookId),
        children: label,
      }),
      (status.phase === "saving" || status.phase === "saved") &&
        /* @__PURE__ */ jsx("span", {
          className: "bar mt-3 block",
          "aria-hidden": true,
          children: /* @__PURE__ */ jsx("span", {
            style: { width: `${Math.round(fraction * 100)}%` },
          }),
        }),
      status.phase === "error" &&
        /* @__PURE__ */ jsx("button", {
          type: "button",
          className: "btn btn-quiet mt-2",
          onClick: () => startFullDownload(bookId),
          children: "Try again",
        }),
    ],
  });
}
function BookmarkRow({ book, mark }) {
  const chapter = book.chapters.find((item) => item.id === mark.chapterId);
  return /* @__PURE__ */ jsxs("li", {
    className: "flex items-center gap-2",
    children: [
      /* @__PURE__ */ jsxs("button", {
        type: "button",
        className: "chapter-row flex-1",
        onClick: () => {
          usePlayer
            .getState()
            .play(book, mark.chapterId, true, mark.time)
            .then(() => {
              usePlayer.getState().openPlayer();
            });
        },
        children: [
          /* @__PURE__ */ jsx(Bookmark, {
            className: "h-4 w-4 shrink-0 text-primary",
          }),
          /* @__PURE__ */ jsx("span", {
            className: "min-w-0 flex-1 truncate",
            children: chapter?.title ?? "Chapter",
          }),
          /* @__PURE__ */ jsx("span", {
            className: "tabular-nums text-sm text-muted",
            children: formatTime(mark.time),
          }),
        ],
      }),
      /* @__PURE__ */ jsx("button", {
        type: "button",
        className: "icon-btn",
        "aria-label": "Remove bookmark",
        onClick: () => usePlayer.getState().removeBookmark(mark.id),
        children: /* @__PURE__ */ jsx(X, { className: "h-4 w-4" }),
      }),
    ],
  });
}
function MiniPlayer() {
  const active = usePlayer((state) => state.active);
  const playing = usePlayer((state) => state.playing);
  const currentTime = usePlayer((state) => state.currentTime);
  const duration = usePlayer((state) => state.duration);
  if (!active) return null;
  const chapter = active.chapters.find((item) => item.id === active.chapterId);
  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  return /* @__PURE__ */ jsxs("div", {
    className: "dock",
    children: [
      /* @__PURE__ */ jsx("div", {
        className: "bar",
        "aria-hidden": true,
        children: /* @__PURE__ */ jsx("span", { style: { width: `${pct}%` } }),
      }),
      /* @__PURE__ */ jsxs("div", {
        className: "mx-auto flex max-w-5xl items-center gap-3 px-3 py-2",
        children: [
          /* @__PURE__ */ jsxs("button", {
            type: "button",
            className: "flex min-w-0 flex-1 items-center gap-3 text-left",
            onClick: () => usePlayer.getState().openPlayer(),
            children: [
              /* @__PURE__ */ jsx("span", {
                className: "w-10 shrink-0",
                children: /* @__PURE__ */ jsx(CoverArt, {
                  title: active.title,
                  src: active.cover,
                }),
              }),
              /* @__PURE__ */ jsxs("span", {
                className: "min-w-0",
                children: [
                  /* @__PURE__ */ jsx("span", {
                    className: "block truncate font-display",
                    children: active.title,
                  }),
                  /* @__PURE__ */ jsx("span", {
                    className: "block truncate text-sm text-muted",
                    children: chapter?.title,
                  }),
                ],
              }),
            ],
          }),
          /* @__PURE__ */ jsx("button", {
            type: "button",
            className: "play-btn h-11 w-11",
            "aria-label": playing ? "Pause" : "Play",
            onClick: () => void usePlayer.getState().toggle(),
            children: /* @__PURE__ */ jsx(PlayPauseIcon, { playing }),
          }),
        ],
      }),
    ],
  });
}
function NowPlaying() {
  const active = usePlayer((state) => state.active);
  const playing = usePlayer((state) => state.playing);
  const buffering = usePlayer((state) => state.buffering);
  const currentTime = usePlayer((state) => state.currentTime);
  const duration = usePlayer((state) => state.duration);
  const rate = usePlayer((state) => state.rate);
  const volume = usePlayer((state) => state.volume);
  const sleep = usePlayer((state) => state.sleep);
  const error = usePlayer((state) => state.error);
  const bookmarks = usePlayer((state) => state.bookmarks);
  const [note, setNote] = useState(null);
  const [reading, setReading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (sleep.mode !== "minutes") return;
    const id = window.setInterval(() => setNow(Date.now()), 1e3);
    return () => window.clearInterval(id);
  }, [sleep.mode]);
  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(null), 2400);
    return () => window.clearTimeout(id);
  }, [note]);
  if (!active)
    return /* @__PURE__ */ jsx("main", {
      className: "mx-auto max-w-lg px-5 py-8",
      children: /* @__PURE__ */ jsxs("button", {
        type: "button",
        className: "btn btn-quiet",
        onClick: () => usePlayer.getState().closePlayer(),
        children: [
          /* @__PURE__ */ jsx(ArrowLeft, { className: "h-4 w-4" }),
          "Back",
        ],
      }),
    });
  const index = active.chapters.findIndex(
    (chapter) => chapter.id === active.chapterId,
  );
  const chapter = active.chapters[index];
  const bookmarked = bookmarks.some(
    (mark) =>
      mark.bookId === active.bookId &&
      mark.chapterId === active.chapterId &&
      Math.abs(mark.time - currentTime) < 2,
  );
  const sleepLabel =
    sleep.mode === "minutes"
      ? `${formatTime(Math.max(0, (sleep.endsAt - now) / 1e3))} left`
      : sleep.mode === "chapter"
        ? "Until this chapter ends"
        : null;
  return /* @__PURE__ */ jsxs("main", {
    className: "mx-auto flex min-h-dvh max-w-lg flex-col px-5 py-4",
    children: [
      /* @__PURE__ */ jsxs("div", {
        className: "flex items-center justify-between",
        children: [
          /* @__PURE__ */ jsx("button", {
            type: "button",
            className: "icon-btn",
            "aria-label": "Close player",
            onClick: () => usePlayer.getState().closePlayer(),
            children: /* @__PURE__ */ jsx(ArrowLeft, { className: "h-5 w-5" }),
          }),
          /* @__PURE__ */ jsx("p", {
            className: "text-sm text-muted",
            children: sleepLabel ?? "Now playing",
          }),
          /* @__PURE__ */ jsx("button", {
            type: "button",
            className: "icon-btn",
            "aria-label": bookmarked
              ? "Remove bookmark"
              : "Bookmark this moment",
            "aria-pressed": bookmarked,
            onClick: () => {
              const time = usePlayer.getState().currentTime;
              const result = usePlayer.getState().toggleBookmark();
              setNote(
                result === "saved"
                  ? `Marked at ${formatTime(time)}`
                  : "Bookmark removed",
              );
            },
            children: /* @__PURE__ */ jsx(Bookmark, {
              className: bookmarked
                ? "h-5 w-5 fill-current text-primary"
                : "h-5 w-5",
            }),
          }),
        ],
      }),
      /* @__PURE__ */ jsx("div", {
        className: "now-cover mt-4",
        children: /* @__PURE__ */ jsx(CoverArt, {
          title: active.title,
          src: active.cover,
        }),
      }),
      /* @__PURE__ */ jsx("h1", {
        className: "mt-4 text-center text-3xl",
        children: active.title,
      }),
      /* @__PURE__ */ jsxs("p", {
        className: "mt-1 text-center text-muted",
        children: [active.author, chapter ? ` · ${chapter.title}` : ""],
      }),
      active.narrator &&
        /* @__PURE__ */ jsxs("p", {
          className: "text-center text-sm text-muted",
          children: ["Read by ", active.narrator],
        }),
      error &&
        /* @__PURE__ */ jsx("p", {
          className: "mt-2 text-center text-sm text-primary",
          role: "alert",
          children: error,
        }),
      buffering &&
        !error &&
        /* @__PURE__ */ jsx("p", {
          className: "mt-2 text-center text-sm text-muted",
          children: "Loading chapter…",
        }),
      /* @__PURE__ */ jsx("p", {
        className: "sr-only",
        "aria-live": "polite",
        children: note ?? "",
      }),
      note &&
        /* @__PURE__ */ jsx("p", {
          className: "mt-2 text-center text-sm text-primary",
          children: note,
        }),
      /* @__PURE__ */ jsxs("label", {
        className: "mt-2 block",
        children: [
          /* @__PURE__ */ jsx("span", {
            className: "sr-only",
            children: "Seek",
          }),
          /* @__PURE__ */ jsx("input", {
            className: "scrub",
            type: "range",
            min: 0,
            max: duration || 0,
            step: 0.1,
            value: duration ? Math.min(currentTime, duration) : 0,
            disabled: !duration,
            onChange: (event) =>
              usePlayer.getState().seek(Number(event.target.value)),
          }),
        ],
      }),
      /* @__PURE__ */ jsxs("div", {
        className: "flex justify-between text-sm tabular-nums text-muted",
        children: [
          /* @__PURE__ */ jsx("span", { children: formatTime(currentTime) }),
          /* @__PURE__ */ jsx("span", {
            children: duration ? formatTime(duration) : "–:––",
          }),
        ],
      }),
      /* @__PURE__ */ jsxs("div", {
        className: "mt-2 flex items-center justify-center gap-3",
        children: [
          /* @__PURE__ */ jsx("button", {
            type: "button",
            className: "icon-btn",
            "aria-label": "Previous chapter",
            disabled: index <= 0,
            onClick: () => void usePlayer.getState().stepChapter(-1),
            children: /* @__PURE__ */ jsx(SkipBack, { className: "h-5 w-5" }),
          }),
          /* @__PURE__ */ jsx("button", {
            type: "button",
            className: "icon-btn",
            "aria-label": "Back 15 seconds",
            onClick: () => usePlayer.getState().skip(-15),
            children: /* @__PURE__ */ jsx("span", {
              className: "text-sm font-semibold tabular-nums",
              children: "−15",
            }),
          }),
          /* @__PURE__ */ jsx("button", {
            type: "button",
            className: "play-btn",
            "aria-label": playing ? "Pause" : "Play",
            onClick: () => void usePlayer.getState().toggle(),
            children: /* @__PURE__ */ jsx(PlayPauseIcon, { playing }),
          }),
          /* @__PURE__ */ jsx("button", {
            type: "button",
            className: "icon-btn",
            "aria-label": "Forward 30 seconds",
            onClick: () => usePlayer.getState().skip(30),
            children: /* @__PURE__ */ jsx("span", {
              className: "text-sm font-semibold tabular-nums",
              children: "+30",
            }),
          }),
          /* @__PURE__ */ jsx("button", {
            type: "button",
            className: "icon-btn",
            "aria-label": "Next chapter",
            disabled: index < 0 || index >= active.chapters.length - 1,
            onClick: () => void usePlayer.getState().stepChapter(1),
            children: /* @__PURE__ */ jsx(SkipForward, {
              className: "h-5 w-5",
            }),
          }),
        ],
      }),
      /* @__PURE__ */ jsx("div", {
        className: "mt-5 flex flex-wrap justify-center gap-2",
        children: RATES.map((value) =>
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: value === rate ? "btn btn-primary" : "btn btn-quiet",
              "aria-pressed": value === rate,
              onClick: () => usePlayer.getState().setRate(value),
              children: formatRate(value),
            },
            value,
          ),
        ),
      }),
      /* @__PURE__ */ jsxs("div", {
        className: "mt-4",
        children: [
          /* @__PURE__ */ jsxs("p", {
            className:
              "mb-2 flex items-center justify-center gap-2 text-sm text-muted",
            children: [
              /* @__PURE__ */ jsx(Timer, { className: "h-4 w-4" }),
              "Sleep",
            ],
          }),
          /* @__PURE__ */ jsxs("div", {
            className: "flex flex-wrap justify-center gap-2",
            children: [
              /* @__PURE__ */ jsx(SleepChip, {
                label: "Off",
                pressed: sleep.mode === "off",
                onClick: () => usePlayer.getState().setSleep("off"),
              }),
              /* @__PURE__ */ jsx(SleepChip, {
                label: "15 min",
                pressed: sleep.mode === "minutes" && sleep.minutes === 15,
                onClick: () => usePlayer.getState().setSleep(15),
              }),
              /* @__PURE__ */ jsx(SleepChip, {
                label: "30 min",
                pressed: sleep.mode === "minutes" && sleep.minutes === 30,
                onClick: () => usePlayer.getState().setSleep(30),
              }),
              /* @__PURE__ */ jsx(SleepChip, {
                label: "45 min",
                pressed: sleep.mode === "minutes" && sleep.minutes === 45,
                onClick: () => usePlayer.getState().setSleep(45),
              }),
              /* @__PURE__ */ jsx(SleepChip, {
                label: "End of chapter",
                pressed: sleep.mode === "chapter",
                onClick: () => usePlayer.getState().setSleep("chapter"),
              }),
            ],
          }),
        ],
      }),
      /* @__PURE__ */ jsxs("label", {
        className: "mt-4 flex items-center gap-3",
        children: [
          volume === 0
            ? /* @__PURE__ */ jsx(VolumeX, {
                className: "h-5 w-5 shrink-0 text-muted",
              })
            : /* @__PURE__ */ jsx(Volume2, {
                className: "h-5 w-5 shrink-0 text-muted",
              }),
          /* @__PURE__ */ jsx("span", {
            className: "sr-only",
            children: "Volume",
          }),
          /* @__PURE__ */ jsx("input", {
            className: "volume",
            type: "range",
            min: 0,
            max: 1,
            step: 0.01,
            value: volume,
            onChange: (event) =>
              usePlayer.getState().setVolume(Number(event.target.value)),
          }),
        ],
      }),
      chapter?.text &&
        /* @__PURE__ */ jsxs("button", {
          type: "button",
          className: "btn btn-quiet mx-auto mt-4",
          "aria-expanded": reading,
          onClick: () => setReading((value) => !value),
          children: [
            /* @__PURE__ */ jsx(BookOpen, { className: "h-4 w-4" }),
            reading ? "Hide text" : "Read along",
          ],
        }),
      reading &&
        chapter?.text &&
        /* @__PURE__ */ jsx("div", {
          className: "transcript mt-3",
          children: chapter.text.split(/\n\n+/).map((paragraph, index) =>
            /* @__PURE__ */ jsx(
              "p",
              {
                className: "mb-3 last:mb-0",
                children: paragraph,
              },
              index,
            ),
          ),
        }),
      /* @__PURE__ */ jsx("p", {
        className: "mt-4 mb-2 text-center text-sm text-muted",
        children:
          "Space plays. Arrows skip. Shift and an arrow changes chapter.",
      }),
    ],
  });
}
function SleepChip({ label, pressed, onClick }) {
  return /* @__PURE__ */ jsx("button", {
    type: "button",
    className: pressed ? "btn btn-primary" : "btn btn-quiet",
    "aria-pressed": pressed,
    onClick,
    children: label,
  });
}
