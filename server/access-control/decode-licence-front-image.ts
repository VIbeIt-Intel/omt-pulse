import sharp from "sharp";
import { parseSaLicenceFrontOcr, type ParsedLicenceFrontOcr } from "@shared/parse-sa-licence-front";

type OcrWorker = {
  recognize: (image: Buffer) => Promise<{ data: { text: string } }>;
};

let workerPromise: Promise<OcrWorker> | null = null;

async function getOcrWorker(): Promise<OcrWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng", 1, {
        logger: () => {
          /* quiet */
        },
      });
      await worker.setParameters({
        tessedit_pageseg_mode: "6" as unknown as string,
      });
      return worker;
    })();
  }
  return workerPromise;
}

async function ocrPngBuffer(worker: OcrWorker, png: Buffer): Promise<string> {
  const { data } = await worker.recognize(png);
  return data.text ?? "";
}

/** OCR the front of a SA driver's licence on the server (avoids crashing mobile WebViews). */
export async function decodeLicenceFrontFromImageBuffer(
  imageBuffer: Buffer,
): Promise<ParsedLicenceFrontOcr> {
  const worker = await getOcrWorker();
  const oriented = await sharp(imageBuffer).rotate().toBuffer();

  const pipelines = [
    sharp(oriented).resize({ width: 2200, withoutEnlargement: true }).grayscale().normalize().sharpen(),
    sharp(oriented).resize({ width: 2000, withoutEnlargement: true }).normalize().sharpen(),
    sharp(oriented).grayscale().normalize().linear(1.3, -40).sharpen(),
    sharp(oriented).rotate(90).resize({ width: 2200, withoutEnlargement: true }).grayscale().normalize(),
    sharp(oriented).rotate(270).resize({ width: 2200, withoutEnlargement: true }).grayscale().normalize(),
  ];

  let best: ParsedLicenceFrontOcr | null = null;

  for (const pipeline of pipelines) {
    try {
      const png = await pipeline.png().toBuffer();
      const text = await ocrPngBuffer(worker, png);
      const parsed = parseSaLicenceFrontOcr(text);
      if (parsed.personIdNumber && parsed.personFullName) {
        return parsed;
      }
      if (parsed.personIdNumber && !best?.personIdNumber) {
        best = parsed;
      } else if (!best && (parsed.personIdNumber || parsed.personFullName)) {
        best = parsed;
      }
    } catch {
      /* try next preprocess variant */
    }
  }

  return (
    best ?? {
      hint: "Could not read the front of the licence. Use brighter light, less glare on the plastic, and fill the frame with the text side.",
    }
  );
}
