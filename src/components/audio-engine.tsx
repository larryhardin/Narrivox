import { useEffect, useRef } from "react";
import { registerAudio } from "@/lib/audio-bus";
import { usePlayer } from "@/lib/player-store";

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

    const onTime = () => {
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
    };
    const onPlay = () => usePlayer.getState().setPlaying(true);
    const onPause = () => usePlayer.getState().setPlaying(false);
    const onWaiting = () => usePlayer.getState().setBuffering(true);
    const onReady = () => usePlayer.getState().setBuffering(false);
    const onEnded = () => {
      const sleep = usePlayer.getState().sleep;
      usePlayer.getState().markChapterDone();
      if (sleep.mode === "chapter") {
        usePlayer.getState().clearSleep();
        usePlayer.getState().setPlaying(false);
        return;
      }
      void usePlayer.getState().stepChapter(1).then((moved) => {
        if (!moved) usePlayer.getState().setPlaying(false);
      });
    };
    const onError = () => {
      if (!audio.getAttribute("src") && !audio.src) return;
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
        audio.pause();
        usePlayer.getState().clearSleep();
      }
    }, 400);

    return () => {
      window.clearInterval(timer);
      unsubscribe();
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
    };
  }, []);

  useEffect(() => {
    if (!title) {
      document.title = "Narrivox";
      return;
    }
    document.title = chapterTitle ? `${chapterTitle} — ${title}` : title;
    if (!("mediaSession" in navigator)) return;
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
    bind("pause", () => ref.current?.pause());
    bind("previoustrack", () => void usePlayer.getState().stepChapter(-1));
    bind("nexttrack", () => void usePlayer.getState().stepChapter(1));
    bind("seekbackward", () => usePlayer.getState().skip(-15));
    bind("seekforward", () => usePlayer.getState().skip(30));
  }, [author, chapterTitle, cover, title]);

  useEffect(() => {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    }
    const native = (
      window as unknown as {
        NightstandNative?: { setPlaying: (on: boolean) => void };
      }
    ).NightstandNative;
    try {
      native?.setPlaying(playing);
    } catch {
      // The Android shell is the only place this bridge exists.
    }
  }, [playing]);

  return <audio ref={ref} preload="none" className="sr-only" />;
}
