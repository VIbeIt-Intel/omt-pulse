import sharp from "sharp";
import { parseSaLicenceFrontOcr, type ParsedLicenceFrontOcr } from "@shared/parse-sa-licence-front";

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
  if (parsed.personIdNumber) score += 100;
  if (parsed.personFullName) score += 40;
  if (parsed.driversLicenceNumber) score += 10;
  return score;
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
        if (parsed.personIdNumber && parsed.personFullName) {
          return parsed;
        }
      } catch {
        /* try next */
      }
    }
  }

  if (best?.personIdNumber || best?.personFullName) {
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
