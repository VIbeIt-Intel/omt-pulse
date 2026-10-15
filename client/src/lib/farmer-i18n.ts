export type FarmerLang = "af" | "en";

const STORAGE_KEY = "omt_farmer_lang";

export function readFarmerLang(): FarmerLang {
  try {
    return localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "af";
  } catch {
    return "af";
  }
}

export function writeFarmerLang(lang: FarmerLang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch { /* ignore */ }
}

const copy = {
  af: {
    langLabel: "English",
    signOut: "Teken uit",
    vuur: "Vuur",
    misdaad: "Misdaad",
    paniek: "Paniek",
    chat: "Chat",
    vuurHint: "Rook of 'n brand",
    misdaadHint: "Diefstal, inbraak, verdagte",
    paniekHint: "Hulp nou",
    chatHint: "Praat met die groep",
    activeFire: "Daar brand 'n vuur",
    openFire: "Maak oop",
    back: "Terug",
    reportFire: "Rapporteer vuur",
    onMyFarm: "Op my plaas",
    seeSmoke: "Ek sien rook",
    smokeHelp: "Tik op die kaart waar die rook is.",
    note: "Nota (nie verpligtend nie)",
    sendFire: "Stuur vuurwaarskuwing",
    sending: "Stuur…",
    fireSent: "Vuurwaarskuwing gestuur",
    fireJoined: "Jy het by die bestaande vuur aangesluit",
    firesNow: "Vure wat nog brand",
    noFires: "Geen vuur op die oomblik nie.",
    closeFire: "Vuur is uit",
    reportedBy: "Gerapporteer deur",
    crimeTitle: "Misdaad",
    crimeHelp: "Kies wat gebeur het. Jou naam en die tyd word self ingevul.",
    kinds: {
      stock_theft: "Veediefstal",
      burglary: "Inbraak",
      suspicious_vehicle: "Verdagte voertuig",
      suspicious_person: "Verdagte persoon",
      other: "Iets anders",
    },
    whatHappened: "Wat het gebeur?",
    photo: "Foto",
    sendCrime: "Stuur verslag",
    crimeSent: "Verslag gestuur",
    recent: "Onlangse verslae",
    noCrime: "Nog niks gerapporteer nie.",
    gpsUsed: "Jou foon se ligging word saamgestuur.",
    panicTitle: "Stuur PANIEK?",
    panicBefore: "Dit waarsku ",
    panicEmphasis: "almal",
    panicAfter: " in die vereniging dadelik. Jou GPS-ligging word gedeel.",
    panicConfirm: "BEVESTIG — Stuur",
    panicSending: "Stuur…",
    panicCancel: "Kanselleer",
    panicGps: "GPS gereed — jou ligging word ingesluit.",
    panicLocationOff: "Ligging is af of onbeskikbaar. Skakel GPS hieronder aan.",
    panicSendAnyway: "Stuur tog (sonder GPS)",
    panicGoBack: "Gaan terug",
    you: "Jy",
  },
  en: {
    langLabel: "Afrikaans",
    signOut: "Sign out",
    vuur: "Fire",
    misdaad: "Crime",
    paniek: "Panic",
    chat: "Chat",
    vuurHint: "Smoke or a fire",
    misdaadHint: "Theft, burglary, suspicious",
    paniekHint: "Help now",
    chatHint: "Talk to the group",
    activeFire: "A fire is burning",
    openFire: "Open",
    back: "Back",
    reportFire: "Report a fire",
    onMyFarm: "On my farm",
    seeSmoke: "I can see smoke",
    smokeHelp: "Tap the map where the smoke is.",
    note: "Note (optional)",
    sendFire: "Send fire alert",
    sending: "Sending…",
    fireSent: "Fire alert sent",
    fireJoined: "You joined the fire that is already burning",
    firesNow: "Fires still burning",
    noFires: "No fire right now.",
    closeFire: "Fire is out",
    reportedBy: "Reported by",
    crimeTitle: "Crime",
    crimeHelp: "Choose what happened. Your name and the time are filled in.",
    kinds: {
      stock_theft: "Stock theft",
      burglary: "Burglary",
      suspicious_vehicle: "Suspicious vehicle",
      suspicious_person: "Suspicious person",
      other: "Something else",
    },
    whatHappened: "What happened?",
    photo: "Photo",
    sendCrime: "Send report",
    crimeSent: "Report sent",
    recent: "Recent reports",
    noCrime: "Nothing reported yet.",
    gpsUsed: "This phone's location is sent with the report.",
    panicTitle: "Send PANIC?",
    panicBefore: "This immediately alerts ",
    panicEmphasis: "everyone",
    panicAfter: " in the association. Your GPS location will be shared.",
    panicConfirm: "CONFIRM — Send",
    panicSending: "Sending…",
    panicCancel: "Cancel",
    panicGps: "GPS ready — your position will be included.",
    panicLocationOff: "Location is off or unavailable. Turn GPS on below.",
    panicSendAnyway: "Send anyway (no GPS)",
    panicGoBack: "Go back",
    you: "You",
  },
} as const;

export type FarmerCopy = (typeof copy)[FarmerLang];

export function farmerCopy(lang: FarmerLang): FarmerCopy {
  return copy[lang];
}
