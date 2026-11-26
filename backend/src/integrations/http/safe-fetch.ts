/**
 * Safe fetcher — EVERY outbound HTTP request to an address we did not choose (look-alike websites, feeds, URLs
 * found in emails) must go through this (docs/port §5.1).
 *
 *   - only http/https
 *   - resolves the host and refuses private, loopback, link-local, CGNAT, multicast, reserved and cloud-metadata
 *     addresses; the connection is pinned to the address that was checked, so DNS rebinding cannot swap it
 *   - follows redirects by hand (max FETCH_MAX_REDIRECTS) and re-checks every hop
 *   - timeout per request, response size cap (streams and aborts), retries transport errors / 429 / 5xx on GET
 *   - rate-limits requests per host (Redis, shared by every worker; in-process fallback)
 *   - never writes anything to disk; callers decide what to store (evidence goes to object storage only)
 */
import { lookup as dnsLookup } from "node:dns/promises"
import { isIP } from "node:net"
import { connect as tlsConnect } from "node:tls"
import ipaddr from "ipaddr.js"
import type { Redis } from "ioredis"
import { Agent, request, type Dispatcher } from "undici"
import { logger } from "../../infra/logger.js"

export class FetchError extends Error {
  constructor(
    message: string,
    readonly kind: "blocked" | "too_large" | "network" | "dns" | "redirects" | "timeout" = "network",
  ) {
    super(message)
  }
}

export interface FetchOptions {
  method?: "GET" | "HEAD" | "POST"
  headers?: Record<string, string>
  body?: string
  maxBytes?: number
  timeoutMs?: number
}

export interface FetchResult {
  url: string
  finalUrl: string
  status: number
  headers: Record<string, string>
  body: Buffer
  peerIp: string
  redirects: string[]
  elapsedMs: number
}

export interface SafeFetchSettings {
  userAgent: string
  timeoutMs: number
  maxBytes: number
  maxRedirects: number
  perHostPerMinute: number
  /** hosts allowed even if they resolve to private addresses (local test fixtures only) */
  allowPrivateHosts: string[]
  keyPrefix: string
}

const METADATA_IPS = new Set(["169.254.169.254", "fd00:ec2::254", "100.100.100.200"])

/** True when the address must never be contacted */
export function forbiddenIp(raw: string): boolean {
  const ip = raw.split("%")[0]!
  if (METADATA_IPS.has(ip)) return true
  if (!ipaddr.isValid(ip)) return true
  let addr = ipaddr.parse(ip)
  if (addr.kind() === "ipv6") {
    const v6 = addr as ipaddr.IPv6
    if (v6.isIPv4MappedAddress()) addr = v6.toIPv4Address()
    else if (v6.range() === "rfc6052") {
      // NAT64 64:ff9b::/96 embeds an IPv4 address in the last 32 bits
      const b = v6.toByteArray().slice(12)
      addr = ipaddr.fromByteArray(b)
    }
  }
  if (METADATA_IPS.has(addr.toString())) return true
  return addr.range() !== "unicast"
}

/** Leaf TLS certificate of a host (legacy fetch_certificate) */
export interface Certificate {
  present: boolean
  subject_cn?: string | null
  issuer_cn?: string | null
  issuer_org?: string | null
  san?: string[]
  not_before?: string
  not_after?: string
  expired?: boolean
  self_signed?: boolean
  serial?: string
  sha256?: string
  protocol?: string | null
  error?: string
}

export class SafeFetcher {
  private readonly localWindow = new Map<string, number[]>()

  constructor(
    private readonly settings: SafeFetchSettings,
    private readonly redis?: Redis,
  ) {}

  /** Resolve and check every address; returns the address to connect to */
  async checkDestination(url: URL): Promise<string> {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchError(`${url.href}: scheme not allowed`, "blocked")
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
    if (!host) throw new FetchError(`${url.href}: no host`, "blocked")
    const allowPrivate = this.settings.allowPrivateHosts.includes(host)
    let addresses: string[]
    if (isIP(host)) addresses = [host]
    else {
      try {
        addresses = (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address)
      } catch (err) {
        throw new FetchError(`DNS resolution failed for ${host}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`, "dns")
      }
    }
    if (!addresses.length) throw new FetchError(`DNS resolution failed for ${host}`, "dns")
    if (!allowPrivate) {
      const bad = addresses.find(forbiddenIp)
      if (bad) throw new FetchError(`${host} resolves to a non-public address (${bad})`, "blocked")
    }
    return addresses[0]!
  }

  /** Requests per host per minute, shared through Redis; waits for the next minute when over the limit */
  private async rateLimit(host: string): Promise<void> {
    const limit = this.settings.perHostPerMinute
    for (let attempt = 0; attempt < 3; attempt++) {
      const minute = Math.floor(Date.now() / 60_000)
      let count: number
      try {
        if (!this.redis) throw new Error("no redis")
        const key = `${this.settings.keyPrefix}fetchrate:${host}:${minute}`
        count = await this.redis.incr(key)
        if (count === 1) await this.redis.expire(key, 61)
      } catch {
        const now = Date.now()
        const window = (this.localWindow.get(host) ?? []).filter((t) => now - t < 60_000)
        window.push(now)
        this.localWindow.set(host, window)
        count = window.length
      }
      if (count <= limit) return
      await new Promise((r) => setTimeout(r, (minute + 1) * 60_000 - Date.now() + 50))
    }
  }

  /** One request to one URL, connected to the checked address only */
  private async oneHop(url: URL, opts: Required<Pick<FetchOptions, "method" | "maxBytes" | "timeoutMs">> & FetchOptions) {
    const ip = await this.checkDestination(url)
    await this.rateLimit(url.hostname)
    // Pin the socket to the checked address; TLS still uses the hostname for SNI
    const dispatcher: Dispatcher = new Agent({
      connect: {
        rejectUnauthorized: false, // look-alike sites often have bad certificates; we inspect, never trust
        lookup: (_hostname, _options, cb) => cb(null, [{ address: ip, family: ip.includes(":") ? 6 : 4 }]),
      },
      connectTimeout: opts.timeoutMs,
      headersTimeout: opts.timeoutMs,
      bodyTimeout: opts.timeoutMs,
    })
    const signal = AbortSignal.timeout(opts.timeoutMs)
    try {
      const res = await request(url, {
        method: opts.method,
        headers: { "user-agent": this.settings.userAgent, accept: "*/*", ...opts.headers },
        body: opts.body,
        dispatcher,
        signal, // undici.request never follows redirects itself; we follow them by hand below
      })
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(res.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v ?? "")
      const declared = Number(headers["content-length"])
      if (Number.isFinite(declared) && declared > opts.maxBytes) {
        res.body.destroy()
        throw new FetchError(`${url.href}: response larger than ${opts.maxBytes} bytes`, "too_large")
      }
      const chunks: Buffer[] = []
      let size = 0
      if (opts.method !== "HEAD") {
        for await (const chunk of res.body) {
          size += (chunk as Buffer).length
          if (size > opts.maxBytes) {
            res.body.destroy()
            throw new FetchError(`${url.href}: response larger than ${opts.maxBytes} bytes`, "too_large")
          }
          chunks.push(chunk as Buffer)
        }
      } else res.body.destroy()
      return { status: res.statusCode, headers, body: Buffer.concat(chunks), ip }
    } catch (err) {
      if (err instanceof FetchError) throw err
      if (signal.aborted) throw new FetchError(`${url.href}: timed out after ${opts.timeoutMs} ms`, "timeout")
      throw new FetchError(`${url.href}: ${(err as Error).message}`, "network")
    } finally {
      void dispatcher.close()
    }
  }

  async fetch(rawUrl: string, options: FetchOptions = {}): Promise<FetchResult> {
    const started = Date.now()
    const opts = {
      method: options.method ?? "GET",
      maxBytes: options.maxBytes ?? this.settings.maxBytes,
      timeoutMs: options.timeoutMs ?? this.settings.timeoutMs,
      headers: options.headers,
      body: options.body,
    } as const
    let current: URL
    try {
      current = new URL(rawUrl)
    } catch {
      throw new FetchError(`${rawUrl}: not a valid URL`, "blocked")
    }
    const origin = current.host
    const redirects: string[] = []

    for (let hop = 0; hop <= this.settings.maxRedirects; hop++) {
      const sameHost = current.host === origin
      const hopOpts = { ...opts, headers: sameHost ? opts.headers : undefined, body: hop === 0 ? opts.body : undefined }
      let res: Awaited<ReturnType<SafeFetcher["oneHop"]>> | undefined
      // 2 attempts at most; retry only what can succeed a moment later (busy / reset), never refused or unknown hosts
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          res = await this.oneHop(current, hopOpts)
          const retryable = res.status === 429 || (res.status >= 500 && (opts.method === "GET" || opts.method === "HEAD"))
          if (!retryable || attempt === 2) break
        } catch (err) {
          const e = err as FetchError
          const transient = e.kind === "network" && /ECONNRESET|EPIPE|socket hang up|other side closed/i.test(e.message)
          if (!transient || attempt === 2) throw e
        }
        await new Promise((r) => setTimeout(r, attempt * 500))
      }
      const location = res!.headers.location
      if (res!.status >= 300 && res!.status < 400 && location) {
        current = new URL(location, current)
        redirects.push(current.href)
        continue
      }
      return {
        url: rawUrl,
        finalUrl: current.href,
        status: res!.status,
        headers: res!.headers,
        body: res!.body,
        peerIp: res!.ip,
        redirects,
        elapsedMs: Date.now() - started,
      }
    }
    throw new FetchError(`${rawUrl}: too many redirects`, "redirects")
  }

  /** TLS certificate on port 443 (destination-checked and rate-limited like any request; never trusted) */
  async certificate(host: string, timeoutMs = 10_000): Promise<Certificate> {
    let ip: string
    try {
      ip = await this.checkDestination(new URL(`https://${host}/`))
    } catch (err) {
      return { present: false, error: (err as Error).message }
    }
    await this.rateLimit(host)
    return new Promise((resolve) => {
      const socket = tlsConnect({ host: ip, port: 443, servername: host, rejectUnauthorized: false, timeout: timeoutMs })
      const done = (c: Certificate) => {
        socket.destroy()
        resolve(c)
      }
      socket.once("secureConnect", () => {
        const x = socket.getPeerX509Certificate()
        if (!x) return done({ present: false, error: "no certificate presented" })
        const field = (dn: string, key: string) => new RegExp(`(?:^|\n)${key}=([^\n]+)`).exec(dn)?.[1] ?? null
        const notAfter = new Date(x.validTo)
        done({
          present: true,
          subject_cn: field(x.subject, "CN"),
          issuer_cn: field(x.issuer, "CN"),
          issuer_org: field(x.issuer, "O"),
          san: (x.subjectAltName ?? "").split(",").map((p) => p.trim().replace(/^DNS:/, "")).filter(Boolean).slice(0, 50),
          not_before: new Date(x.validFrom).toISOString(),
          not_after: notAfter.toISOString(),
          expired: notAfter.getTime() < Date.now(),
          self_signed: x.issuer === x.subject,
          serial: x.serialNumber.toLowerCase(),
          sha256: x.fingerprint256.replace(/:/g, "").toLowerCase(),
          protocol: socket.getProtocol(),
        })
      })
      socket.once("timeout", () => done({ present: false, error: `TLS timed out after ${timeoutMs} ms` }))
      socket.once("error", (err) => done({ present: false, error: err.message }))
    })
  }

  /** fetch(), but null (logged) instead of throwing */
  async tryFetch(url: string, options: FetchOptions = {}): Promise<FetchResult | null> {
    try {
      return await this.fetch(url, options)
    } catch (err) {
      logger.debug({ url, err: (err as Error).message }, "fetch failed")
      return null
    }
  }
}
