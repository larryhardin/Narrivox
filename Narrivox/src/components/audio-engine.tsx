import { useEffect, useRef } from "react";
import { getAudio, markUserPause, registerAudio, takeUserPause } from "@/lib/audio-bus";
import { usePlayer } from "@/lib/player-store";

type NativePlayback = {
  setPlaying?: (on: boolean) => void;
  updatePlayback?: (
    title: string,
    artist: string,
    chapter: string,
    playing: boolean,
    positionMs: number,
    durationMs: number,
    cover: string,
  ) => void;
};

let lastNativePush = 0;

function syncNativePlayback() {
  const native = (window as unknown as { NightstandNative?: NativePlayback }).NightstandNative;
  if (!native) return;
  const state = usePlayer.getState();
  const active = state.active;
  try {
    if (!native.updatePlayback) {
      native.setPlaying?.(Boolean(active) && state.playing);
      return;
    }
    if (!active) {
      native.updatePlayback("", "", "", false, 0, 0, "");
      return;
    }
    const chapter = active.chapters.find((item) => item.id === active.chapterId);
    const rawCover = active.cover ?? "";
    const cover =
      rawCover.startsWith("/") || rawCover.startsWith("http://") || rawCover.startsWith("https://")
        ? rawCover
        : "";
    const ended = getAudio()?.ended === true;
    let durationMs = Math.max(0, Math.round((Number.isFinite(state.duration) ? state.duration : 0) * 1000));
    let positionMs = Math.max(0, Math.round(state.currentTime * 1000));
    if (durationMs > 0 && positionMs >= durationMs) positionMs = durationMs - 1;
    native.updatePlayback(
      active.title,
      active.author,
      chapter?.title ?? "",
      state.playing && !ended,
      positionMs,
      durationMs,
      cover,
    );
  } catch {
    // The Android shell is the only place this bridge exists.
  }
}

export function AudioEngine() {
  const ref = useRef<HTMLAudioElement>(null);
  const title = usePlayer((state) => state.active?.title ?? "");
  const author = usePlayer((state) => state.active?.author ?? "");
  const cover = usePlayer((state) => state.active?.cover);
  const chapterTitle = usePlayer((state) => {
    const active = state.active;
    if (!active) return "";
    return active.chapters.find((chapter) => chapter.id === active.chapterId)?.title ?? "";
  });
  const playing = usePlayer((state) => state.playing);

  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    registerAudio(audio);
    audio.preservesPitch = true;
    audio.volume = usePlayer.getState().volume;
    audio.playbackRate = usePlayer.getState().rate;
    let bounces = 0;
    const lockWindow = window as unknown as { __narrivoxLock?: (action: string) => void };
    lockWindow.__narrivoxLock = (action) => {
      const store = usePlayer.getState();
      if (action === "play") {
        if (!store.playing) void store.toggle();
        return;
      }
      if (action === "pause") {
        markUserPause();
        audio.pause();
        return;
      }
      if (action === "back") store.skip(-15);
      if (action === "forward") store.skip(30);
    };

    const onTime = () => {
      if (audio.ended) return;
      if (audio.currentTime > 1) bounces = 0;
      usePlayer.getState().setClock(audio.currentTime, audio.duration);
      if ("mediaSession" in navigator && Number.isFinite(audio.duration) && audio.duration > 0) {
        try {
          navigator.mediaSession.setPositionState({
            duration: audio.duration,
            playbackRate: audio.playbackRate || 1,
            position: Math.min(audio.currentTime, audio.duration),
          });
        } catch {
          // Ignore browsers that reject position state mid-load.
        }
      }
      const now = Date.now();
      if (now - lastNativePush > 1000) {
        lastNativePush = now;
        syncNativePlayback();
      }
    };
    const onPlay = () => usePlayer.getState().setPlaying(true);
    const onPause = () => {
      if (takeUserPause()) {
        bounces = 0;
        usePlayer.getState().setPlaying(false);
        return;
      }
      // Android can pause the page once when the lock-screen session appears.
      if (!audio.ended && audio.currentTime < 0.5 && bounces < 1 && usePlayer.getState().playing) {
        bounces += 1;
        void audio.play();
        return;
      }
      bounces = 0;
      usePlayer.getState().setPlaying(false);
    };
    const onWaiting = () => usePlayer.getState().setBuffering(true);
    const onReady = () => usePlayer.getState().setBuffering(false);
    const onEnded = () => {
      const duration = audio.duration;
      const finished =
        Number.isFinite(duration) && duration > 1 && audio.currentTime >= duration - 1.25;
      if (!finished) return;
      const sleep = usePlayer.getState().sleep;
      usePlayer.getState().markChapterDone();
      if (sleep.mode === "chapter") {
        usePlayer.getState().clearSleep();
        usePlayer.getState().setPlaying(false);
        return;
      }
      // Leave the ended event before loading the next file. Doing it inline
      // crashes the Android WebView at the end of every chapter.
      window.setTimeout(() => {
        const still = getAudio();
        if (!still || !still.ended) return;
        void usePlayer.getState().stepChapter(1).then((moved) => {
          if (!moved) usePlayer.getState().setPlaying(false);
        });
      }, 0);
    };
    const onError = () => {
      if (!audio.getAttribute("src") && !audio.src) return;
      if (audio.error?.code === MediaError.MEDIA_ERR_ABORTED) return;
      usePlayer.getState().setError("This chapter couldn't be played.");
      usePlayer.getState().setBuffering(false);
      usePlayer.getState().setPlaying(false);
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("playing", onReady);
    audio.addEventListener("canplay", onReady);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    let volume = audio.volume;
    let rate = audio.playbackRate;
    const unsubscribe = usePlayer.subscribe((state) => {
      if (state.volume !== volume) {
        volume = state.volume;
        audio.volume = state.volume;
      }
      if (state.rate !== rate) {
        rate = state.rate;
        audio.preservesPitch = true;
        audio.playbackRate = state.rate;
      }
    });

    const timer = window.setInterval(() => {
      const sleep = usePlayer.getState().sleep;
      if (sleep.mode === "minutes" && Date.now() >= sleep.endsAt) {
        markUserPause();
        audio.pause();
        usePlayer.getState().clearSleep();
      }
    }, 400);

    return () => {
      window.clearInterval(timer);
      unsubscribe();
      markUserPause();
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("playing", onReady);
      audio.removeEventListener("canplay", onReady);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      registerAudio(null);
      delete lockWindow.__narrivoxLock;
    };
  }, []);

  useEffect(() => {
    if (!title) {
      document.title = "Narrivox";
      syncNativePlayback();
      return;
    }
    document.title = chapterTitle ? `${chapterTitle} — ${title}` : title;
    if (!("mediaSession" in navigator)) {
      syncNativePlayback();
      return;
    }
    const artwork = cover
      ? [
          {
            src: new URL(cover, window.location.origin).href,
            sizes: "1152x1728",
            type: "image/jpeg",
          },
        ]
      : [];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: chapterTitle || title,
      artist: author,
      album: title,
      artwork,
    });
    const bind = (name: MediaSessionAction, action: () => void) => {
      try {
        navigator.mediaSession.setActionHandler(name, action);
      } catch {
        // This action is not supported here.
      }
    };
    bind("play", () => void usePlayer.getState().toggle());
    bind("pause", () => {
      markUserPause();
      ref.current?.pause();
    });
    bind("previoustrack", () => void usePlayer.getState().stepChapter(-1));
    bind("nexttrack", () => void usePlayer.getState().stepChapter(1));
    bind("seekbackward", () => usePlayer.getState().skip(-15));
    bind("seekforward", () => usePlayer.getState().skip(30));
    syncNativePlayback();
  }, [author, chapterTitle, cover, title]);

  useEffect(() => {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    }
    syncNativePlayback();
  }, [playing]);

  return <audio ref={ref} preload="none" className="sr-only" />;
}
