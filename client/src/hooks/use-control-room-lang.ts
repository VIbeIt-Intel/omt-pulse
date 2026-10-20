import { useSyncExternalStore } from "react";
import {
  controlRoomCopy,
  readControlRoomLang,
  writeControlRoomLang,
  type ControlRoomLang,
} from "@/lib/control-room-i18n";

let currentLang: ControlRoomLang = readControlRoomLang();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ControlRoomLang {
  return currentLang;
}

function setSharedLang(next: ControlRoomLang) {
  writeControlRoomLang(next);
  currentLang = next;
  listeners.forEach((listener) => listener());
}

export function useControlRoomLang() {
  const lang = useSyncExternalStore(subscribe, getSnapshot, () => "en" as ControlRoomLang);
  function setLang(next: ControlRoomLang) {
    setSharedLang(next);
  }
  function toggle() {
    setSharedLang(lang === "af" ? "en" : "af");
  }
  return { lang, setLang, toggle, t: controlRoomCopy(lang) };
}
