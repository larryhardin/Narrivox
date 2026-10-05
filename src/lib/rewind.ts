export function rewindTarget(current: number, seconds: number, earlierDurations: number[]) {
  const safeCurrent = Math.max(0, current);
  if (safeCurrent >= seconds) return { stepsBack: 0, time: safeCurrent - seconds };
  let leftover = seconds - safeCurrent;
  for (let index = 0; index < earlierDurations.length; index += 1) {
    const duration = earlierDurations[index] ?? 0;
    if (duration > leftover) return { stepsBack: index + 1, time: duration - leftover };
    leftover -= Math.max(0, duration);
  }
  return { stepsBack: Math.max(earlierDurations.length, 0), time: 0 };
}
