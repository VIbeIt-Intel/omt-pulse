import sharp from "sharp";
import {
  extractBirthDateYymmddFromOcrText,
  idPrefixMatchesBirthDate,
  isPlausibleLicencePersonName,
  isPlausibleSaIdBirthDate,
  parseSaLicenceFrontOcr,
  type ParsedLicenceFrontOcr,
} from "@shared/parse-sa-licence-front";

type OcrWorker = {
  setParameters: (params: Record<string, string>) => Promise<unknown>;
  recognize: (image: Buffer) => Promise<{ data: { text: string } }>;
};

let workerPromise: Promise<OcrWorker> | null = null;

const PSM_MODES = ["6", "4", "11", "3"] as const;

async function getOcrWorker(): Promise<OcrWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng", 1, {
        logger: () => {
          /* quiet */
        },
      });
      return worker;
    })();
  }
  return workerPromise;
}

async function ocrPngBuffer(
  worker: OcrWorker,
  png: Buffer,
  psm: string,
): Promise<string> {
  await worker.setParameters({
    tessedit_pageseg_mode: psm,
  });
  const { data } = await worker.recognize(png);
  return data.text ?? "";
}

type PreprocessStep = {
  label: string;
  build: (oriented: Buffer) => sharp.Sharp;
};

function preprocessSteps(oriented: Buffer): PreprocessStep[] {
  const meta = sharp(oriented);
  return [
    {
      label: "upscale-gray",
      build: () =>
        meta
          .clone()
          .resize({ width: 2600, withoutEnlargement: false, kernel: sharp.kernel.lanczos3 })
          .grayscale()
          .normalize()
          .sharpen({ sigma: 1.4 }),
    },
    {
      label: "high-contrast",
      build: () =>
        meta
          .clone()
          .resize({ width: 2400, withoutEnlargement: false })
          .grayscale()
          .normalize()
          .linear(1.5, -55)
          .sharpen(),
    },
    {
      label: "threshold",
      build: () =>
        meta
          .clone()
          .resize({ width: 2400, withoutEnlargement: false })
          .grayscale()
          .normalize()
          .median(1)
          .threshold(140),
    },
    {
      label: "color-sharp",
      build: () =>
        meta.clone().resize({ width: 2200, withoutEnlargement: false }).normalize().sharpen(),
    },
    {
      label: "rot90",
      build: () =>
        meta
          .clone()
          .rotate(90)
          .resize({ width: 2400, withoutEnlargement: false })
          .grayscale()
          .normalize(),
    },
    {
      label: "rot270",
      build: () =>
        meta
          .clone()
          .rotate(270)
          .resize({ width: 2400, withoutEnlargement: false })
          .grayscale()
          .normalize(),
    },
  ];
}

function scoreResult(parsed: ParsedLicenceFrontOcr): number {
  let score = 0;
  if (parsed.personIdNumber) {
    score += 100;
    if (isPlausibleSaIdBirthDate(parsed.personIdNumber)) score += 80;
  }
  if (parsed.personFullName) {
    const n = parsed.personFullName.toUpperCase();
    if (!/CONDUC|CARTA|LICEN|DRIV|AFRICA|REPUBLIC/.test(n)) score += 40;
    else score -= 50;
  }
  if (parsed.driversLicenceNumber) score += 10;
  return score;
}

function isGoodEnough(parsed: ParsedLicenceFrontOcr, ocrText: string): boolean {
  if (!parsed.personIdNumber || !isPlausibleSaIdBirthDate(parsed.personIdNumber)) return false;
  if (!parsed.personFullName || !isPlausibleLicencePersonName(parsed.personFullName)) return false;

  const birthYymmdd = extractBirthDateYymmddFromOcrText(ocrText);
  if (birthYymmdd && !idPrefixMatchesBirthDate(parsed.personIdNumber, birthYymmdd)) return false;

  const n = parsed.personFullName.toUpperCase();
  if (/CONDUC|CARTA|LICEN|DRIV|AFRICA|REPUBLIC|MALE|FEMALE/.test(n)) return false;
  return true;
}

/** OCR the front of a SA driver's licence on the server (avoids crashing mobile WebViews). */
export async function decodeLicenceFrontFromImageBuffer(
  imageBuffer: Buffer,
): Promise<ParsedLicenceFrontOcr> {
  const worker = await getOcrWorker();
  const oriented = await sharp(imageBuffer).rotate().toBuffer();

  let best: ParsedLicenceFrontOcr | null = null;
  let bestScore = 0;
  let bestTextSnippet = "";
  let winningTextSnippet = "";

  // A Luhn-valid, birthdate-plausible ID can still be a coincidental misread (13 digits give
  // ~1000x odds against random noise, but noisy card text isn't random). Require the SAME ID to
  // show up from at least two independently preprocessed copies of the photo before trusting it —
  // real digits survive different contrast/sharpen passes; a stray sliding-window artifact usually
  // won't reproduce identically.
  const idCandidates = new Map<
    string,
    { votes: number; score: number; parsed: ParsedLicenceFrontOcr; text: string }
  >();

  for (const step of preprocessSteps(oriented)) {
    let png: Buffer;
    try {
      png = await step.build().png().toBuffer();
    } catch {
      continue;
    }

    for (const psm of PSM_MODES) {
      try {
        const text = await ocrPngBuffer(worker, png, psm);
        const parsed = parseSaLicenceFrontOcr(text);
        const score = scoreResult(parsed);
        if (score > bestScore) {
          bestScore = score;
          best = parsed;
          bestTextSnippet = text.replace(/\s+/g, " ").trim().slice(0, 120);
        }

        if (isGoodEnough(parsed, text) && parsed.personIdNumber) {
          const id = parsed.personIdNumber;
          const existing = idCandidates.get(id);
          const votes = (existing?.votes ?? 0) + 1;
          if (!existing || score >= existing.score) {
            idCandidates.set(id, { votes, score, parsed, text });
          } else {
            idCandidates.set(id, { ...existing, votes });
          }

          if (votes >= 2) {
            console.log(
              `[licence-front-ocr] confirmed id after ${votes} agreeing reads — snippet="${text.replace(/\s+/g, " ").trim().slice(0, 160)}"`,
            );
            return parsed;
          }
        }
      } catch {
        /* try next */
      }
    }
  }

  // No ID got a second independent match — fall back to the best-scoring single-source hit,
  // but flag it as unconfirmed in the logs so a wrong ID here is easy to trace back.
  if (idCandidates.size > 0) {
    const topCandidate = [...idCandidates.values()].sort((a, b) => b.score - a.score)[0]!;
    winningTextSnippet = topCandidate.text.replace(/\s+/g, " ").trim().slice(0, 160);
    console.warn(
      `[licence-front-ocr] single-source id (no second match) — id=${topCandidate.parsed.personIdNumber} snippet="${winningTextSnippet}"`,
    );
    return topCandidate.parsed;
  }

  if (best?.personIdNumber || best?.personFullName) {
    console.warn(
      `[licence-front-ocr] returning best-effort (below good-enough bar) — snippet="${bestTextSnippet}"`,
    );
    return best;
  }

  if (bestTextSnippet) {
    console.warn(`[licence-front-ocr] no fields — ocr snippet="${bestTextSnippet}"`);
  }

  return (
    best ?? {
      hint: "Could not read the front of the licence. Hold the card flat, fill the frame, tilt slightly to reduce plastic glare, and use bright light.",
    }
  );
}
