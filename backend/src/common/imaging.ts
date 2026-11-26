/**
 * Image fingerprints for recognising copies of a brand's logo/favicon.
 *
 *   phash   perceptual hash: grey, 32×32, 2-D DCT, top-left 8×8 vs their median  → 16 hex chars
 *   dhash   difference hash: grey, 9×8, each pixel brighter than its left neighbour → 16 hex chars
 *   mmh3    Shodan-style favicon hash (MurmurHash3 of the base64 file), signed 32-bit
 *
 * Images are first composited on white, then trimmed to their content (border = colour of the top-left pixel).
 * Note: resampling differs slightly from Pillow, so hashes can differ by a few bits from the Python ones;
 * compare Node hashes with Node hashes (recompute stored assets after migrating data).
 */
import sharp, { type Sharp } from "sharp"
import decodeIco from "decode-ico"

export interface ImageHashes {
  phash: string
  dhash: string
}

interface Rgb {
  data: Buffer
  width: number
  height: number
}

/** Decode any supported image (PNG, JPG, GIF, WEBP, BMP, TIFF, AVIF, ICO) to RGB on white; null if unreadable */
export async function loadRgb(bytes: Buffer): Promise<Rgb | null> {
  try {
    let input: Sharp
    if (isIco(bytes)) {
      const images = decodeIco(bytes)
      if (!images.length) return null
      const best = images.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a))
      input =
        best.type === "png"
          ? sharp(Buffer.from(best.data))
          : sharp(Buffer.from(best.data), { raw: { width: best.width, height: best.height, channels: 4 } })
    } else {
      input = sharp(bytes, { pages: 1 })
    }
    const { data, info } = await input.flatten({ background: "#ffffff" }).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true })
    return { data, width: info.width, height: info.height }
  } catch {
    return null
  }
}

const isIco = (b: Buffer) => b.length > 6 && b[0] === 0 && b[1] === 0 && (b[2] === 1 || b[2] === 2) && b[3] === 0

/** Pillow's "L" conversion: L = R*299/1000 + G*587/1000 + B*114/1000 */
function toGray(img: Rgb): Buffer {
  const out = Buffer.alloc(img.width * img.height)
  for (let i = 0, p = 0; i < out.length; i++, p += 3) {
    out[i] = Math.floor((img.data[p]! * 299 + img.data[p + 1]! * 587 + img.data[p + 2]! * 114) / 1000)
  }
  return out
}

/** Crop away a uniform border (pixels within 12 grey levels of the top-left pixel) */
function trim(img: Rgb): Rgb {
  const gray = toGray(img)
  const bg = gray[0]!
  let minX = img.width
  let minY = img.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (Math.abs(gray[y * img.width + x]! - bg) > 12) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return img
  const w = maxX - minX + 1
  const h = maxY - minY + 1
  const data = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) img.data.copy(data, y * w * 3, ((minY + y) * img.width + minX) * 3, ((minY + y) * img.width + minX + w) * 3)
  return { data, width: w, height: h }
}

async function grayResized(img: Rgb, width: number, height: number): Promise<Float64Array> {
  const gray = toGray(img)
  const resized = await sharp(gray, { raw: { width: img.width, height: img.height, channels: 1 } })
    .resize(width, height, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer()
  return Float64Array.from(resized)
}

/** 64 booleans, row-major, first = most significant bit → 16 hex chars */
function bitsToHex(bits: boolean[]): string {
  let hex = ""
  for (let i = 0; i < bits.length; i += 4) hex += ((+bits[i]! << 3) | (+bits[i + 1]! << 2) | (+bits[i + 2]! << 1) | +bits[i + 3]!).toString(16)
  return hex
}

/** Unnormalised DCT-II (scipy.fftpack.dct default); scale does not matter for a median comparison */
function dct1d(v: Float64Array): Float64Array {
  const n = v.length
  const out = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    let s = 0
    for (let i = 0; i < n; i++) s += v[i]! * Math.cos((Math.PI * k * (2 * i + 1)) / (2 * n))
    out[k] = 2 * s
  }
  return out
}

async function phash(img: Rgb): Promise<string> {
  const N = 32
  const px = await grayResized(img, N, N)
  // DCT along columns (axis 0), then rows (axis 1)
  const cols = new Float64Array(N * N)
  for (let x = 0; x < N; x++) {
    const col = new Float64Array(N)
    for (let y = 0; y < N; y++) col[y] = px[y * N + x]!
    const d = dct1d(col)
    for (let y = 0; y < N; y++) cols[y * N + x] = d[y]!
  }
  const low: number[] = []
  for (let y = 0; y < 8; y++) {
    const d = dct1d(cols.subarray(y * N, y * N + N))
    for (let x = 0; x < 8; x++) low.push(d[x]!)
  }
  const sorted = [...low].sort((a, b) => a - b)
  const median = (sorted[31]! + sorted[32]!) / 2
  return bitsToHex(low.map((v) => v > median))
}

async function dhash(img: Rgb): Promise<string> {
  const px = await grayResized(img, 9, 8)
  const bits: boolean[] = []
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits.push(px[y * 9 + x + 1]! > px[y * 9 + x]!)
  return bitsToHex(bits)
}

/** Fingerprints of an image, or null when it is not a readable image or is smaller than 8 px */
export async function hashesFor(bytes: Buffer): Promise<ImageHashes | null> {
  const img = await loadRgb(bytes)
  if (!img || Math.min(img.width, img.height) < 8) return null
  const t = trim(img)
  return { phash: await phash(t), dhash: await dhash(t) }
}

/** 0–100: how alike two images are (average of phash and dhash similarity) */
export function matchScore(a: ImageHashes, b: ImageHashes): number {
  const ham = (x: string, y: string) => {
    let d = 0
    for (let i = 0; i < 16; i++) {
      let v = parseInt(x[i]!, 16) ^ parseInt(y[i]!, 16)
      while (v) {
        d += v & 1
        v >>= 1
      }
    }
    return d
  }
  const s = (1 - ham(a.phash, b.phash) / 64 + (1 - ham(a.dhash, b.dhash) / 64)) / 2
  return Math.round(Math.max(0, s) * 100 * 100) / 100
}

/** Shodan favicon hash: MurmurHash3 (x86, 32-bit, seed 0) of the base64 text with a newline every 76 chars and at the end */
export function faviconHash(bytes: Buffer): number {
  const b64 = bytes.toString("base64")
  let text = ""
  for (let i = 0; i < b64.length; i += 76) text += `${b64.slice(i, i + 76)}\n`
  return murmur3(Buffer.from(text, "ascii")) | 0
}

export function murmur3(key: Buffer, seed = 0): number {
  const c1 = 0xcc9e2d51
  const c2 = 0x1b873593
  let h = seed >>> 0
  const blocks = key.length & ~3
  for (let i = 0; i < blocks; i += 4) {
    let k = key[i]! | (key[i + 1]! << 8) | (key[i + 2]! << 16) | (key[i + 3]! << 24)
    k = Math.imul(k, c1)
    k = (k << 15) | (k >>> 17)
    k = Math.imul(k, c2)
    h ^= k
    h = (h << 13) | (h >>> 19)
    h = (Math.imul(h, 5) + 0xe6546b64) | 0
  }
  let k = 0
  switch (key.length & 3) {
    case 3:
      k ^= key[blocks + 2]! << 16
    // falls through
    case 2:
      k ^= key[blocks + 1]! << 8
    // falls through
    case 1:
      k ^= key[blocks]!
      k = Math.imul(k, c1)
      k = (k << 15) | (k >>> 17)
      k = Math.imul(k, c2)
      h ^= k
  }
  h ^= key.length
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h | 0
}
