import { Capacitor } from "@capacitor/core";
import { TextToSpeech } from "@capacitor-community/text-to-speech";

const isNative = Capacitor.isNativePlatform();

export async function speak(text: string, lang: string = "en-US"): Promise<void> {
  if (!text) return;
  try {
    if (isNative) {
      try {
        await TextToSpeech.stop();
      } catch {
      }
      await TextToSpeech.speak({
        text,
        lang,
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0,
        category: "ambient",
      });
      return;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = lang;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utt);
    }
  } catch {
  }
}

export async function stopSpeaking(): Promise<void> {
  try {
    if (isNative) {
      await TextToSpeech.stop();
      return;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  } catch {
  }
}
