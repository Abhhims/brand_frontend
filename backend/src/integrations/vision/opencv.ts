/**
 * OpenCV (WebAssembly build) loaded once per process.
 *
 * The module object is a "thenable" whose then() hands back the module itself, so it must never be passed to
 * resolve() or returned from an async function (the promise would chase it forever). It is always handed out
 * wrapped in an object: `const { cv } = await loadOpenCv()`.
 */
import { createRequire } from "node:module"

export type CV = typeof import("@techstark/opencv-js")

const require = createRequire(import.meta.url)
let loading: Promise<{ cv: CV }> | null = null

export function loadOpenCv(timeoutMs = 30_000): Promise<{ cv: CV }> {
  loading ??= new Promise<{ cv: CV }>((resolve, reject) => {
    const mod = require("@techstark/opencv-js") as CV & { Mat?: unknown }
    const started = Date.now()
    const tick = () => {
      if (mod.Mat) resolve({ cv: mod })
      else if (Date.now() - started > timeoutMs) reject(new Error("OpenCV did not finish loading"))
      else setTimeout(tick, 15)
    }
    tick()
  }).catch((err: unknown) => {
    loading = null
    throw err
  })
  return loading
}
