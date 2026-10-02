import { popBackLayer } from "@/lib/back-stack";

type NativeBridge = {
  exitApp?: () => void;
  backgroundApp?: () => void;
};

type BackWindow = Window & {
  __narrivoxBack?: () => void;
  NightstandNative?: NativeBridge;
};

export function backgroundNativeApp() {
  const native = (window as BackWindow).NightstandNative;
  if (native?.backgroundApp) {
    native.backgroundApp();
    return;
  }
  native?.exitApp?.();
}

export function handleAndroidBack() {
  if (popBackLayer()) return;
  backgroundNativeApp();
}

export function installAndroidBack() {
  const target = window as BackWindow;
  target.__narrivoxBack = handleAndroidBack;
  return () => {
    if (target.__narrivoxBack === handleAndroidBack) delete target.__narrivoxBack;
  };
}
