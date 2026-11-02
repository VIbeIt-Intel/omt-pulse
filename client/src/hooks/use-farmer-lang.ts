import { useEffect, useState } from "react";
import { farmerCopy, readFarmerLang, writeFarmerLang, type FarmerLang } from "@/lib/farmer-i18n";

const LANG_EVENT = "omt:farmer-lang";

export function useFarmerLang() {
  const [lang, setLangState] = useState<FarmerLang>(readFarmerLang);
  useEffect(() => {
    const sync = () => setLangState(readFarmerLang());
    window.addEventListener(LANG_EVENT, sync);
    return () => window.removeEventListener(LANG_EVENT, sync);
  }, []);
  function setLang(next: FarmerLang) {
    writeFarmerLang(next);
    setLangState(next);
    window.dispatchEvent(new Event(LANG_EVENT));
  }
  function toggle() {
    setLang(lang === "af" ? "en" : "af");
  }
  return { lang, setLang, toggle, t: farmerCopy(lang) };
}
