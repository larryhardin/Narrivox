let audio: HTMLAudioElement | null = null;

export function registerAudio(el: HTMLAudioElement | null) {
  audio = el;
}

export function getAudio() {
  return audio;
}
