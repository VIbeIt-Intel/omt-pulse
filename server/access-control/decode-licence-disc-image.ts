import sharp from "sharp";
import {
  parseSaLicenceDiscOcr,
  scoreLicenceDiscOcr,
  type ParsedLicenceDiscOcr,
} from "@shared/parse-sa-licence-disc";

type OcrWorker = {
  setParameters: (params: Record<string, string>) => Promise<unknown>;
  recognize: (image: Buffer) => Promise<{ data: { text: string } }>;
};

let workerPromise: Promise<OcrWorker> | null = null;

const PSM_MODES = ["6", "4", "11"] as const;

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

async function ocrPngBuffer(worker: OcrWorker, png: Buffer, psm: string): Promise<string> {
  await worker.setParameters({ tessedit_pageseg_mode: psm });
  const { data } = await worker.recognize(png);
  return data.text ?? "";
}

/** OCR the printed face of a SA licence disc on the server. */
export async function decodeLicenceDiscFromImageBuffer(
  imageBuffer: Buffer,
): Promise<ParsedLicenceDiscOcr> {
  const worker = await getOcrWorker();
  const oriented = await sharp(imageBuffer).rotate().toBuffer();

  let best: ParsedLicenceDiscOcr | null = null;
  let bestScore = 0;
  let bestSnippet = "";

  const variants = [
    sharp(oriented)
      .clone()
      .resize({ width: 2600, withoutEnlargement: false, kernel: sharp.kernel.lanczos3 })
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1.4 }),
    sharp(oriented)
      .clone()
      .resize({ width: 2400, withoutEnlargement: false })
      .grayscale()
      .normalize()
      .linear(1.5, -55)
      .sharpen(),
  ];

  for (const variant of variants) {
    let png: Buffer;
    try {
      png = await variant.png().toBuffer();
    } catch {
      continue;
    }

    for (const psm of PSM_MODES) {
      try {
        const text = await ocrPngBuffer(worker, png, psm);
        const parsed = parseSaLicenceDiscOcr(text);
        const score = scoreLicenceDiscOcr(parsed);
        if (score > bestScore) {
          bestScore = score;
          best = parsed;
          bestSnippet = text.replace(/\s+/g, " ").trim().slice(0, 160);
        }
      } catch {
        /* try next */
      }
    }
  }

  if (best && bestScore >= 70) {
    console.log(
      `[licence-disc-ocr] success — reg=${best.registration ?? "?"} make=${best.make ?? "?"} score=${bestScore}`,
    );
    return best;
  }

  if (best?.registration || best?.make || best?.model) {
    console.warn(`[licence-disc-ocr] partial — snippet="${bestSnippet}" score=${bestScore}`);
    return best;
  }

  console.warn(`[licence-disc-ocr] no fields — snippet="${bestSnippet}"`);
  return (
    best ?? {
      hint: "Could not read the licence disc. Fill the frame with the printed face (not only the barcode) and reduce windshield glare.",
    }
  );
}
