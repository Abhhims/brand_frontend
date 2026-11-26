import { readFileSync } from "node:fs"
const API = "http://localhost:8020/api/v1"
const H = { authorization: `Bearer ${readFileSync(process.env.TEMP + "/bi-token.txt", "utf8")}` }
const id = readFileSync(process.env.TEMP + "/bi-brand.txt", "utf8")
const j = async (path, init = {}) => { const r = await fetch(API + path, { ...init, headers: { ...H, ...(init.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}) } }); return { status: r.status, body: await r.json().catch(() => null) } }
for (const url of ["https://www.paypalobjects.com/paypal-ui/logos/svg/paypal-color.svg", "https://www.paypalobjects.com/webstatic/mktg/logo/pp_cc_mark_111x69.jpg"]) {
  const r = await fetch(url); const buf = Buffer.from(await r.arrayBuffer())
  const form = new FormData(); form.append("kind", "logo"); form.append("file", new Blob([buf]), url.split("/").pop())
  const up = await j(`/brands/${id}/assets`, { method: "POST", body: form })
  console.log(`upload logo ${url.split("/").pop()}: http ${r.status} → ${up.status} ${up.status !== 201 ? JSON.stringify(up.body) : ""}`)
}
for (const d of ["de-paypal-sec.com", "paypal-verify.vercel.app"]) {
  const r = await j("/phishing/check", { method: "POST", body: JSON.stringify({ brand_id: id, domain: d }) }); const b = r.body ?? {}
  console.log(`check ${d}: ${b.verdict} | ${b.risk_level} ${b.risk_score} conf ${b.confidence} | logo ${b.logo_match} (${b.logo_match_score}) fav ${b.favicon_match} | images ${b.details?.["Images Compared"]}/${b.details?.["Images Found"]} | top ${JSON.stringify(b.details?.["Top Image Matches"]?.slice(0, 2))}`)
  if (b.scoring) console.log("   rules:", JSON.stringify(b.scoring.risk.rules), "cap:", b.scoring.risk.cap)
}
const scan = await j("/phishing/scans", { method: "POST", body: JSON.stringify({ brand_id: id, max_variants: 400 }) })
const t0 = Date.now(); let s
do { await new Promise((r) => setTimeout(r, 10000)); s = (await j(`/phishing/scans/${scan.body.id}`)).body } while (["queued", "running"].includes(s.status) && Date.now() - t0 < 25 * 60_000)
console.log(`scan: ${s.status} in ${Math.round((Date.now() - t0) / 1000)}s`, JSON.stringify(s.stats))
for (const c of s.components) console.log(`  [${c.status}] ${c.name} ${JSON.stringify(c.counts)} ${c.message.slice(0, 160)}`)
const list = await j(`/phishing/domains?brand_id=${id}&page_size=12`)
console.log("domains total:", list.body.total)
for (const d of list.body.items) console.log(`  ${d.risk_level.padEnd(8)} ${String(d.risk_score).padStart(3)} ${d.domain.padEnd(36)} ${d.stage.padEnd(9)} logo:${d.logo_match}(${d.logo_match_score}) ${d.source_label} [${d.fraud_themes.join(",")}]`)
