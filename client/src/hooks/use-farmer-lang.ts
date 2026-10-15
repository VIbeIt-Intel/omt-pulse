import { useEffect, useState } from "react";
import { farmerCopy, readFarmerLang, writeFarmerLang, type FarmerLang } from "@/lib/farmer-i18n";

export function useFarmerLang() {
  const [lang, setLangState] = useState<FarmerLang>("af");
  useEffect(() => {
    setLangState(readFarmerLang());
  }, []);
  function setLang(next: FarmerLang) {
    writeFarmerLang(next);
    setLangState(next);
  }
  function toggle() {
    setLang(lang === "af" ? "en" : "af");
  }
  return { lang, setLang, toggle, t: farmerCopy(lang) };
}
