/**
 * Reads the text inside a logo (Tesseract, English model bundled with the app — no network access).
 * One worker per process, created on first use; calls are queued by Tesseract itself.
 */
import { createRequire } from "node:module"
import path from "node:path"
import sharp from "sharp"
import type { Worker } from "tesseract.js"

const require = createRequire(import.meta.url)
let worker: Promise<Worker> | null = null

function getWorker(): Promise<Worker> {
  worker ??= (async () => {
    const { createWorker, OEM } = await import("tesseract.js")
    const langPath = path.join(path.dirname(require.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int")
    return createWorker("eng", OEM.LSTM_ONLY, { langPath, cacheMethod: "none", gzip: true })
  })().catch((err: unknown) => {
    worker = null
    throw err
  })
  return worker
}

/** Text in an image (upper-cased letters/digits/spaces), or "" when nothing readable. Never throws. */
export async function readText(image: Buffer): Promise<string> {
  try {
    const meta = await sharp(image).metadata()
    const h = meta.height ?? 0
    const png = await sharp(image)
      .flatten({ background: "#ffffff" })
      .resize({ height: Math.max(120, Math.min(400, h * 2)), withoutEnlargement: false })
      .grayscale()
      .extend({ top: 20, bottom: 20, left: 20, right: 20, background: "#ffffff" })
      .png()
      .toBuffer()
    const w = await getWorker()
    const r = await w.recognize(png)
    return cleanText(r.data.text)
  } catch {
    return ""
  }
}

export const cleanText = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()

export async function closeOcr(): Promise<void> {
  const w = worker
  worker = null
  if (w) await (await w).terminate().catch(() => {})
}
