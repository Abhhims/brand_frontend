/**
 * Logo matching: is one of the brand's official logos really in this image, and how faithfully is it copied?
 *
 *   1. Find it   — strict fingerprints (an exact copy: pHash AND dHash each ≥ 92) or shape matching: ORB keypoints
 *                  of the official logo (3 sizes) matched to the image, ratio test, RANSAC homography. A match
 *                  needs ≥ 25 consistent points (inliers ≥ 50 % of matches) and a sane geometry (convex box of
 *                  plausible size and proportions). Random images give 0–10 consistent points.
 *   2. Align it  — the found area is warped onto the official logo, pixel to pixel.
 *   3. Compare   — design (correlation of the aligned shapes), colour (CIE Lab distance on the logo's own
 *                  pixels) and text (OCR of the aligned area vs the text read from the official logo / brand name).
 *
 * The verdict needs the logo to be found AND the aligned design to agree (≥ 45) AND an overall score ≥ 70
 * (shape 35 %, design 25 %, colour 20 %, text 20 % — text left out when the official logo has no readable text).
 *
 * OpenCV runs synchronously (WebAssembly) — callers cap how many images they compare per page.
 */
import sharp from "sharp"
import { hashesFor, loadRgb, type ImageHashes } from "../../common/imaging.js"
import { loadOpenCv, type CV } from "./opencv.js"
import { cleanText, readText } from "./ocr.js"

export const MIN_INLIERS = 25
export const MIN_INLIER_RATIO = 0.5
export const MIN_DESIGN = 45
export const MATCH_SCORE = 70
export const FINGERPRINT_MIN = 92
const PAD = 40
const TEMPLATE_WIDTHS = [600, 400, 260, 180]
const MIN_TEMPLATE_KEYPOINTS = 60

export interface LogoAsset {
  id: string
  kind: string
  filename: string
  bytes: Buffer
}

interface Raster {
  rgb: Buffer
  w: number
  h: number
  /** prepared pixels per original pixel */
  scale: number
  origW: number
  origH: number
}

interface TemplateScale extends Raster {
  kps: Float32Array // x,y pairs in prepared coordinates
  desc: Uint8Array // n × 32 ORB descriptors
  n: number
}

export interface LogoTemplate {
  asset: { id: string; kind: string; filename: string; width: number; height: number }
  hashes: ImageHashes | null
  scales: TemplateScale[]
  /** text read from the official logo ("" when none) */
  text: string
  /** enough distinctive points for shape matching (else only exact copies are recognised) */
  shapeable: boolean
}

export interface LogoChecks {
  /** found by shape / fingerprint: 0–100 */
  shape: number
  /** aligned shapes agree: 0–100 */
  design: number
  /** aligned colours agree: 0–100 */
  colour: number
  /** text inside the logo agrees: 0–100, null when the official logo has no readable text */
  text: number | null
}

export interface LogoComparison {
  matched: boolean
  /** overall 0–100 (0 when the logo was not found) */
  score: number
  method: "fingerprint" | "shape" | null
  asset_id: string | null
  checks: LogoChecks
  inliers: number
  inlier_ratio: number
  /** corners of the located logo in the compared image (original pixels), clockwise from top-left */
  box: [number, number][] | null
  /** matched point pairs: official logo x,y → compared image x,y (original pixels), at most 60 */
  points: [number, number, number, number][]
  image_size: [number, number]
  logo_size: [number, number] | null
  text_found: string | null
  text_expected: string | null
  colours: { logo: string[]; found: string[] }
  reason: string
}

const NONE = (reason: string, size: [number, number] = [0, 0]): LogoComparison => ({
  matched: false,
  score: 0,
  method: null,
  asset_id: null,
  checks: { shape: 0, design: 0, colour: 0, text: null },
  inliers: 0,
  inlier_ratio: 0,
  box: null,
  points: [],
  image_size: size,
  logo_size: null,
  text_found: null,
  text_expected: null,
  colours: { logo: [], found: [] },
  reason,
})

// ------------------------------------------------------------------ raster helpers
async function prepare(bytes: Buffer, opts: { width?: number; minShort?: number; maxLong?: number }): Promise<Raster | null> {
  const img = await loadRgb(bytes)
  if (!img || Math.min(img.width, img.height) < 8) return null
  let s = 1
  if (opts.width) s = opts.width / img.width
  else {
    if (opts.minShort && Math.min(img.width, img.height) < opts.minShort) s = opts.minShort / Math.min(img.width, img.height)
    if (opts.maxLong && Math.max(img.width, img.height) * s > opts.maxLong) s = opts.maxLong / Math.max(img.width, img.height)
  }
  const w = Math.max(8, Math.round(img.width * s))
  const h = Math.max(8, Math.round(img.height * s))
  const rgb = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } })
    .resize(w, h, { fit: "fill", kernel: "lanczos3" })
    .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, background: "#ffffff" })
    .raw()
    .toBuffer()
  return { rgb, w: w + 2 * PAD, h: h + 2 * PAD, scale: w / img.width, origW: img.width, origH: img.height }
}

/** ORB keypoints + descriptors of a raster */
function features(cv: CV, r: Raster, max: number): { kps: Float32Array; desc: Uint8Array; n: number } {
  const rgb = cv.matFromArray(r.h, r.w, cv.CV_8UC3, r.rgb)
  const gray = new cv.Mat()
  const kv = new cv.KeyPointVector()
  const desc = new cv.Mat()
  const mask = new cv.Mat()
  const orb = new cv.ORB(max)
  try {
    cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY)
    orb.detectAndCompute(gray, mask, kv, desc)
    const n = desc.rows
    const kps = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) {
      const p = kv.get(i).pt
      kps[i * 2] = p.x
      kps[i * 2 + 1] = p.y
    }
    return { kps, desc: Uint8Array.from(desc.data), n }
  } finally {
    ;[rgb, gray, desc, mask].forEach((m) => m.delete())
    kv.delete()
    orb.delete()
  }
}

interface ShapeHit {
  inliers: number
  ratio: number
  /** 3×3 homography, template-scale prepared → candidate prepared (row-major) */
  H: number[]
  pairs: [number, number, number, number][]
}

function matchShape(cv: CV, t: TemplateScale, c: { kps: Float32Array; desc: Uint8Array; n: number }): ShapeHit | null {
  if (t.n < 8 || c.n < 8) return null
  const dt = cv.matFromArray(t.n, 32, cv.CV_8UC1, t.desc)
  const dc = cv.matFromArray(c.n, 32, cv.CV_8UC1, c.desc)
  const bf = new cv.BFMatcher(cv.NORM_HAMMING, false)
  const knn = new cv.DMatchVectorVector()
  try {
    bf.knnMatch(dt, dc, knn, 2)
    const src: number[] = []
    const dst: number[] = []
    const used = new Set<number>()
    for (let i = 0; i < knn.size(); i++) {
      const m = knn.get(i)
      if (m.size() < 2) continue
      const a = m.get(0)
      const b = m.get(1)
      if (a.distance < 0.75 * b.distance && !used.has(a.trainIdx)) {
        used.add(a.trainIdx)
        src.push(t.kps[a.queryIdx * 2]!, t.kps[a.queryIdx * 2 + 1]!)
        dst.push(c.kps[a.trainIdx * 2]!, c.kps[a.trainIdx * 2 + 1]!)
      }
    }
    const good = src.length / 2
    if (good < 8) return { inliers: 0, ratio: 0, H: [], pairs: [] }
    const s = cv.matFromArray(good, 1, cv.CV_32FC2, src)
    const d = cv.matFromArray(good, 1, cv.CV_32FC2, dst)
    const mask = new cv.Mat()
    const H = cv.findHomography(s, d, cv.RANSAC, 5, mask)
    try {
      if (H.empty()) return { inliers: 0, ratio: 0, H: [], pairs: [] }
      const pairs: [number, number, number, number][] = []
      for (let i = 0; i < good; i++) if (mask.data[i]) pairs.push([src[i * 2]!, src[i * 2 + 1]!, dst[i * 2]!, dst[i * 2 + 1]!])
      return { inliers: pairs.length, ratio: pairs.length / good, H: Array.from(H.data64F), pairs }
    } finally {
      ;[s, d, mask, H].forEach((m) => m.delete())
    }
  } finally {
    dt.delete()
    dc.delete()
    bf.delete()
    knn.delete()
  }
}

const project = (H: number[], x: number, y: number): [number, number] => {
  const w = H[6]! * x + H[7]! * y + H[8]!
  return [(H[0]! * x + H[1]! * y + H[2]!) / w, (H[3]! * x + H[4]! * y + H[5]!) / w]
}

/** The logo's frame projected into the image: convex, plausible size, not wildly skewed, mostly inside */
function saneBox(box: [number, number][], t: Raster, c: Raster): boolean {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = box[i]!
    const [bx, by] = box[(i + 1) % 4]!
    const [cx, cy] = box[(i + 2) % 4]!
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx)
    if (!Number.isFinite(cross) || cross === 0) return false
    if (sign === 0) sign = Math.sign(cross)
    else if (Math.sign(cross) !== sign) return false
  }
  const side = (i: number) => Math.hypot(box[(i + 1) % 4]![0] - box[i]![0], box[(i + 1) % 4]![1] - box[i]![1])
  const top = side(0)
  const right = side(1)
  const bottom = side(2)
  const left = side(3)
  if (Math.max(top, bottom) / Math.max(1, Math.min(top, bottom)) > 2) return false
  if (Math.max(left, right) / Math.max(1, Math.min(left, right)) > 2) return false
  const tw = t.w - 2 * PAD
  const th = t.h - 2 * PAD
  const scale = Math.sqrt(((top + bottom) / 2) * ((left + right) / 2)) / Math.sqrt(tw * th)
  if (scale < 0.08 || scale > 12) return false
  // aspect ratio of the found logo close to the official one
  const aspectT = tw / th
  const aspectF = (top + bottom) / Math.max(1, left + right)
  if (Math.max(aspectT, aspectF) / Math.min(aspectT, aspectF) > 1.6) return false
  // at least 75 % of the box inside the image
  const xs = box.map((p) => p[0])
  const ys = box.map((p) => p[1])
  const bw = Math.max(...xs) - Math.min(...xs)
  const bh = Math.max(...ys) - Math.min(...ys)
  const iw = Math.min(Math.max(...xs), c.w) - Math.max(Math.min(...xs), 0)
  const ih = Math.min(Math.max(...ys), c.h) - Math.max(Math.min(...ys), 0)
  return iw > 0 && ih > 0 && (iw * ih) / Math.max(1, bw * bh) >= 0.75
}

/** Warp the candidate onto the template frame (template prepared size) */
function warpToTemplate(cv: CV, H: number[], t: Raster, c: Raster): Buffer {
  const src = cv.matFromArray(c.h, c.w, cv.CV_8UC3, c.rgb)
  const dst = new cv.Mat()
  const M = cv.matFromArray(3, 3, cv.CV_64FC1, H)
  try {
    cv.warpPerspective(src, dst, M, new cv.Size(t.w, t.h), cv.INTER_LINEAR | cv.WARP_INVERSE_MAP, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255))
    return Buffer.from(dst.data)
  } finally {
    ;[src, dst, M].forEach((m) => m.delete())
  }
}

/** Light/dark reversed copy of an RGB buffer */
function invertRgb(rgb: Buffer): Buffer {
  const out = Buffer.allocUnsafe(rgb.length)
  for (let i = 0; i < rgb.length; i++) out[i] = 255 - rgb[i]!
  return out
}

/** Bounding box of the image content (pixels that differ from the corner colour), in prepared coordinates */
function contentBox(r: Raster): { x: number; y: number; w: number; h: number } {
  const i0 = (PAD * r.w + PAD) * 3
  const bg = [r.rgb[i0]!, r.rgb[i0 + 1]!, r.rgb[i0 + 2]!]
  let x0 = r.w
  let y0 = r.h
  let x1 = -1
  let y1 = -1
  for (let y = PAD; y < r.h - PAD; y++)
    for (let x = PAD; x < r.w - PAD; x++) {
      const i = (y * r.w + x) * 3
      if (Math.abs(r.rgb[i]! - bg[0]!) + Math.abs(r.rgb[i + 1]! - bg[1]!) + Math.abs(r.rgb[i + 2]! - bg[2]!) > 36) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  if (x1 < 0) return { x: PAD, y: PAD, w: r.w - 2 * PAD, h: r.h - 2 * PAD }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** The official logo and the aligned found area, both reduced to the same width (with the same padding) */
async function atWidth(t: Raster, warped: Buffer, width: number): Promise<{ logo: Raster; found: Buffer }> {
  const inner = { left: PAD, top: PAD, width: t.w - 2 * PAD, height: t.h - 2 * PAD }
  const height = Math.max(8, Math.round((inner.height * width) / inner.width))
  const shrink = async (rgb: Buffer) =>
    sharp(rgb, { raw: { width: t.w, height: t.h, channels: 3 } })
      .extract(inner)
      .resize(width, height, { fit: "fill", kernel: "cubic" })
      .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, background: "#ffffff" })
      .raw()
      .toBuffer()
  const logo = await shrink(t.rgb)
  return { logo: { rgb: logo, w: width + 2 * PAD, h: height + 2 * PAD, scale: 1, origW: width, origH: height }, found: await shrink(warped) }
}

// ------------------------------------------------------------------ colour / design
function lab(r: number, g: number, b: number): [number, number, number] {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const R = lin(r)
  const G = lin(g)
  const B = lin(b)
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047)
  const y = f(R * 0.2126 + G * 0.7152 + B * 0.0722)
  const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

/** Pixels of the logo itself (differ from its background colour), inside the padded frame */
function foregroundMask(t: Raster): Uint8Array {
  const bgI = (PAD * t.w + PAD) * 3
  const bg = [t.rgb[bgI]!, t.rgb[bgI + 1]!, t.rgb[bgI + 2]!]
  const mask = new Uint8Array(t.w * t.h)
  for (let y = PAD; y < t.h - PAD; y++)
    for (let x = PAD; x < t.w - PAD; x++) {
      const i = (y * t.w + x) * 3
      const d = Math.abs(t.rgb[i]! - bg[0]!) + Math.abs(t.rgb[i + 1]! - bg[1]!) + Math.abs(t.rgb[i + 2]! - bg[2]!)
      if (d > 60) mask[y * t.w + x] = 1
    }
  return mask
}

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`

/** Up to 3 dominant colours of the masked pixels (coarse 4-bit buckets) */
function dominant(rgb: Buffer, mask: Uint8Array): string[] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue
    const r = rgb[p * 3]!
    const g = rgb[p * 3 + 1]!
    const b = rgb[p * 3 + 2]!
    const k = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)
    const e = buckets.get(k) ?? { n: 0, r: 0, g: 0, b: 0 }
    e.n++
    e.r += r
    e.g += g
    e.b += b
    buckets.set(k, e)
  }
  const total = [...buckets.values()].reduce((a, e) => a + e.n, 0)
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .filter((e) => e.n / Math.max(1, total) >= 0.05)
    .slice(0, 3)
    .map((e) => hex(e.r / e.n, e.g / e.n, e.b / e.n))
}

/** Colour agreement on the logo's own pixels: mean ΔE (CIE76) → 0–100 (ΔE 0 → 100, ΔE ≥ 40 → 0) */
function colourScore(t: Raster, warped: Buffer, mask: Uint8Array): number {
  let sum = 0
  let n = 0
  for (let p = 0; p < mask.length; p += 2) {
    if (!mask[p]) continue
    const a = lab(t.rgb[p * 3]!, t.rgb[p * 3 + 1]!, t.rgb[p * 3 + 2]!)
    const b = lab(warped[p * 3]!, warped[p * 3 + 1]!, warped[p * 3 + 2]!)
    sum += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
    n++
  }
  if (!n) return 0
  return Math.round(Math.max(0, Math.min(100, 100 - (sum / n) * 2.5)))
}

/** Design agreement: correlation of the blurred grey shapes over the logo's area → 0–100 */
function designScore(cv: CV, t: Raster, warped: Buffer): number {
  const a = cv.matFromArray(t.h, t.w, cv.CV_8UC3, t.rgb)
  const b = cv.matFromArray(t.h, t.w, cv.CV_8UC3, warped)
  const ga = new cv.Mat()
  const gb = new cv.Mat()
  const res = new cv.Mat()
  try {
    cv.cvtColor(a, ga, cv.COLOR_RGB2GRAY)
    cv.cvtColor(b, gb, cv.COLOR_RGB2GRAY)
    const k = new cv.Size(5, 5)
    cv.GaussianBlur(ga, ga, k, 0)
    cv.GaussianBlur(gb, gb, k, 0)
    const rect = new cv.Rect(PAD, PAD, t.w - 2 * PAD, t.h - 2 * PAD)
    const ra = ga.roi(rect)
    const rb = gb.roi(rect)
    try {
      cv.matchTemplate(rb, ra, res, cv.TM_CCOEFF_NORMED)
      const v = res.data32F[0] ?? 0
      return Math.round(Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)) * 100)
    } finally {
      ra.delete()
      rb.delete()
    }
  } finally {
    ;[a, b, ga, gb, res].forEach((m) => m.delete())
  }
}

// ------------------------------------------------------------------ text
function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return row[b.length]!
}

/** 0–100: does the expected text appear (approximately) in what was read? Spaces are ignored. */
export function textSimilarity(found: string, expected: string[]): number {
  const f = found.replace(/[^A-Z0-9]/g, "")
  let best = 0
  for (const e0 of expected) {
    const e = cleanText(e0).replace(/ /g, "")
    if (e.length < 3 || !f) continue
    if (f.includes(e)) return 100
    // best window of the found text, a little shorter/longer than the expected text
    for (let len = Math.max(1, e.length - 2); len <= e.length + 2; len++)
      for (let i = 0; i + len <= Math.max(len, f.length); i++) {
        const w = f.slice(i, i + len)
        best = Math.max(best, 1 - levenshtein(w, e) / Math.max(w.length, e.length))
      }
  }
  return Math.round(best * 100)
}

// ------------------------------------------------------------------ public API
export class LogoMatcher {
  constructor(private readonly opts: { ocr: boolean } = { ocr: true }) {}

  /** Prepare the official logos once per scan */
  async prepare(assets: LogoAsset[]): Promise<LogoTemplate[]> {
    const { cv } = await loadOpenCv()
    const out: LogoTemplate[] = []
    for (const a of assets) {
      const first = await prepare(a.bytes, { width: TEMPLATE_WIDTHS[0] })
      if (!first) continue
      const scales: TemplateScale[] = []
      for (const width of TEMPLATE_WIDTHS) {
        const r = width === TEMPLATE_WIDTHS[0] ? first : await prepare(a.bytes, { width })
        if (!r || r.h - 2 * PAD < 24) continue
        scales.push({ ...r, ...features(cv, r, 1500) })
      }
      out.push({
        asset: { id: a.id, kind: a.kind, filename: a.filename, width: first.origW, height: first.origH },
        hashes: await hashesFor(a.bytes),
        scales,
        text: this.opts.ocr ? await readText(a.bytes) : "",
        shapeable: (scales[0]?.n ?? 0) >= MIN_TEMPLATE_KEYPOINTS,
      })
    }
    return out
  }

  /** Compare one image with every official logo; the best result is returned */
  async compare(templates: LogoTemplate[], bytes: Buffer, brandTerms: string[] = []): Promise<LogoComparison> {
    if (!templates.length) return NONE("No official logo to compare with")
    const { cv } = await loadOpenCv()
    const cand = await prepare(bytes, { minShort: 240, maxLong: 1400 })
    if (!cand) return NONE("Not a readable image")
    const size: [number, number] = [cand.origW, cand.origH]
    const hashes = await hashesFor(bytes)

    // 1. find: by shape, else an exact copy by fingerprints (small / plain logos)
    let found: { t: LogoTemplate; sc: TemplateScale; H: number[]; method: "fingerprint" | "shape"; hit: ShapeHit | null } | null = null
    let bestInliers = 0
    let bestRatio = 0
    let bestAsset: string | null = templates[0]!.asset.id
    // the logo is also looked for light-on-dark (a white logo on a coloured header, a grey logo on a dark card):
    // shape matching compares light/dark patterns, so the reversed image is searched as well
    let inverted = false
    {
      const variants: { r: Raster; inv: boolean }[] = [
        { r: cand, inv: false },
        { r: { ...cand, rgb: invertRgb(cand.rgb) }, inv: true },
      ]
      let best: { t: LogoTemplate; sc: TemplateScale; hit: ShapeHit; inv: boolean } | null = null
      for (const v of variants) {
        const cf = features(cv, v.r, 3000)
        for (const t of templates) {
          if (!t.shapeable) continue
          for (const sc of t.scales) {
            const hit = matchShape(cv, sc, cf)
            if (!hit || hit.inliers <= bestInliers) continue
            bestInliers = hit.inliers
            bestRatio = hit.ratio
            bestAsset = t.asset.id
            if (hit.inliers >= MIN_INLIERS && hit.ratio >= MIN_INLIER_RATIO && hit.H.length === 9) {
              const box = this.frame(sc).map(([x, y]) => project(hit.H, x, y))
              if (saneBox(box, sc, v.r)) best = { t, sc, hit, inv: v.inv }
            }
          }
        }
      }
      if (best) {
        found = { t: best.t, sc: best.sc, H: best.hit.H, method: "shape", hit: best.hit }
        inverted = best.inv
      }
    }
    if (!found && hashes) {
      const content = contentBox(cand)
      for (const t of templates) {
        if (!t.hashes || !t.scales[0]) continue
        const sim = (x: string, y: string) => {
          let d = 0
          for (let i = 0; i < x.length; i++) {
            let v = parseInt(x[i]!, 16) ^ parseInt(y[i]!, 16)
            while (v) {
              d += v & 1
              v >>= 1
            }
          }
          return 100 * (1 - d / (x.length * 4))
        }
        if (sim(hashes.phash, t.hashes.phash) >= FINGERPRINT_MIN && sim(hashes.dhash, t.hashes.dhash) >= FINGERPRINT_MIN) {
          const sc = t.scales[0]
          const tw = sc.w - 2 * PAD
          const th = sc.h - 2 * PAD
          const aspect = content.w / content.h / (tw / th)
          if (aspect > 1.25 || aspect < 0.8) continue
          const sx = content.w / tw
          const sy = content.h / th
          found = { t, sc, method: "fingerprint", hit: null, H: [sx, 0, content.x - PAD * sx, 0, sy, content.y - PAD * sy, 0, 0, 1] }
          break
        }
      }
    }
    if (!found) {
      const r = NONE(
        bestInliers >= MIN_INLIERS
          ? `Points matched (${bestInliers}) but their layout does not form the logo`
          : `Logo not found: ${bestInliers} consistent matching points (needs ${MIN_INLIERS})`,
        size,
      )
      r.inliers = bestInliers
      r.asset_id = bestAsset
      r.inlier_ratio = Math.round(bestRatio * 100) / 100
      r.checks.shape = Math.round((Math.min(bestInliers, MIN_INLIERS) / MIN_INLIERS) * 50)
      return r
    }

    // 2. align, 3. compare
    const { t, sc, H, method, hit } = found
    const source = inverted ? { ...cand, rgb: invertRgb(cand.rgb) } : cand
    const warped = warpToTemplate(cv, H, sc, source)
    const design = designScore(cv, sc, warped)
    // colours are compared at the size the logo really has in the image, so both sides are equally blurred
    const frameBox = this.frame(sc).map(([x, y]) => project(H, x, y))
    const foundWidth = Math.hypot(frameBox[1]![0] - frameBox[0]![0], frameBox[1]![1] - frameBox[0]![1]) / cand.scale
    const small = await atWidth(sc, warped, Math.max(24, Math.min(sc.w - 2 * PAD, Math.round(foundWidth))))
    const mask = foregroundMask(small.logo)
    // a light-on-dark logo is a legitimate one-colour version: its colours are shown but do not count
    const colour = colourScore(small.logo, small.found, mask)
    const foundColours = inverted
      ? dominant((await atWidth(sc, warpToTemplate(cv, H, sc, cand), Math.max(24, Math.min(sc.w - 2 * PAD, Math.round(foundWidth))))).found, mask)
      : dominant(small.found, mask)
    const expected = [t.text, ...brandTerms].filter((x) => cleanText(x).replace(/ /g, "").length >= 3)
    let text: number | null = null
    let textFound: string | null = null
    if (this.opts.ocr && t.text.replace(/ /g, "").length >= 3) {
      const crop = await sharp(warped, { raw: { width: sc.w, height: sc.h, channels: 3 } }).png().toBuffer()
      textFound = await readText(crop)
      text = textSimilarity(textFound, expected)
    }
    const shape = method === "fingerprint" ? 100 : Math.round(Math.min(100, 60 + ((hit!.inliers - MIN_INLIERS) * 40) / 75))
    const parts: [number, number][] = [
      [shape, 0.35],
      [design, 0.25],
      ...(inverted ? [] : [[colour, 0.2] as [number, number]]),
      ...(text === null ? [] : [[text, 0.2] as [number, number]]),
    ]
    const wsum = parts.reduce((a, [, w]) => a + w, 0)
    const score = Math.round(parts.reduce((a, [v, w]) => a + v * w, 0) / wsum)
    const matched = design >= MIN_DESIGN && score >= MATCH_SCORE

    const toOrigC = (x: number, y: number): [number, number] => [round1((x - PAD) / cand.scale), round1((y - PAD) / cand.scale)]
    const toOrigT = (x: number, y: number): [number, number] => [round1((x - PAD) / sc.scale), round1((y - PAD) / sc.scale)]
    const box = this.frame(sc).map(([x, y]) => {
      const [px, py] = project(H, x, y)
      return toOrigC(px, py)
    })
    const pairs = (hit?.pairs ?? []).filter((_, i, all) => i % Math.max(1, Math.ceil(all.length / 60)) === 0).slice(0, 60)
    const reasons: string[] = []
    if (design < MIN_DESIGN) reasons.push(`design differs (${design})`)
    if (inverted) reasons.push("light-on-dark version of the logo (colour not counted)")
    else if (colour < 50) reasons.push(`colours differ (${colour})`)
    if (text !== null && text < 60) reasons.push(`text differs (read "${textFound || "nothing"}")`)
    return {
      matched,
      score,
      method,
      asset_id: t.asset.id,
      checks: { shape, design, colour, text },
      inliers: hit?.inliers ?? 0,
      inlier_ratio: hit ? Math.round(hit.ratio * 100) / 100 : 1,
      box,
      points: pairs.map(([a, b, c, d]) => [...toOrigT(a, b), ...toOrigC(c, d)] as [number, number, number, number]),
      image_size: size,
      logo_size: [t.asset.width, t.asset.height],
      text_found: textFound,
      text_expected: t.text || null,
      colours: { logo: dominant(small.logo.rgb, mask), found: foundColours },
      reason: matched
        ? `Official logo found by ${method === "shape" ? `shape (${hit!.inliers} points)` : "exact fingerprint"}${reasons.length ? `; ${reasons.join(", ")}` : ""}`
        : `Similar shape but not the official logo: ${reasons.join(", ") || `overall ${score} < ${MATCH_SCORE}`}`,
    }
  }

  /** corners of the logo inside a prepared template, clockwise from top-left */
  private frame(sc: Raster): [number, number][] {
    const x0 = PAD
    const y0 = PAD
    const x1 = sc.w - PAD
    const y1 = sc.h - PAD
    return [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ]
  }
}

const round1 = (v: number) => Math.round(v * 10) / 10
