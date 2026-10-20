import { useState } from "react";
import {
  controlRoomCopy,
  readControlRoomLang,
  writeControlRoomLang,
  type ControlRoomLang,
} from "@/lib/control-room-i18n";

export function useControlRoomLang() {
  const [lang, setLangState] = useState<ControlRoomLang>(() => readControlRoomLang());
  function setLang(next: ControlRoomLang) {
    writeControlRoomLang(next);
    setLangState(next);
  }
  function toggle() {
    setLang(lang === "af" ? "en" : "af");
  }
  return { lang, setLang, toggle, t: controlRoomCopy(lang) };
}
