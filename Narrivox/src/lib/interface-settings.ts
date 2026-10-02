import { persistConfig } from "@/lib/app-vault";

const KEY = "narrivox.interface.v1";

export type InterfaceSettings = {
  skipExitConfirm: boolean;
};

export function interfaceSettingsFrom(raw: string | null): InterfaceSettings {
  if (!raw) return { skipExitConfirm: true };
  try {
    const parsed = JSON.parse(raw) as { skipExitConfirm?: unknown };
    if (parsed.skipExitConfirm === false) return { skipExitConfirm: false };
    return { skipExitConfirm: true };
  } catch {
    return { skipExitConfirm: true };
  }
}

export function readInterfaceSettings(): InterfaceSettings {
  if (typeof localStorage === "undefined") return { skipExitConfirm: true };
  return interfaceSettingsFrom(localStorage.getItem(KEY));
}

export function skipExitConfirm() {
  return readInterfaceSettings().skipExitConfirm;
}

export function setSkipExitConfirm(skip: boolean) {
  localStorage.setItem(KEY, JSON.stringify({ skipExitConfirm: skip }));
  persistConfig();
}
