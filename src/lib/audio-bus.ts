let audio: HTMLAudioElement | null = null;
let userPaused = false;

export function registerAudio(el: HTMLAudioElement | null) {
  audio = el;
}

export function getAudio() {
  return audio;
}

export function markUserPause() {
  userPaused = true;
}

export function takeUserPause() {
  const marked = userPaused;
  userPaused = false;
  return marked;
}

