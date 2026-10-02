// Builds examples.html: a real request and response for every Actuent MCP tool, from live calls to
// https://agents.actuent.ai/api/mcp (free tier, no key). Pro-only tools show the request and the
// response fields, since a live call needs a Pro key. Responses are trimmed (first items of each
// list, long text shortened) so the page stays readable.
// Run: node examples/generate.mjs   (weekly in .github/workflows/examples.yml)

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const MCP = process.env.ACTUENT_MCP || "https://agents.actuent.ai/api/mcp"

async function call(name, args) {
  const r = await fetch(MCP, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream", "User-Agent": "actuent-docs-examples/1.0" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(90000)
  })
  const body = await r.json()
  const text = body?.result?.content?.[0]?.text
  try { return JSON.parse(text) } catch { return text ?? body }
}

// Keeps the shape, not the bulk: 2 items per list, 3 keys of big objects are kept whole, strings cut at 180 chars.
function trim(v, depth = 0) {
  if (Array.isArray(v)) return v.length > 2 ? [...v.slice(0, 2).map(x => trim(x, depth + 1)), `… ${v.length - 2} more`] : v.map(x => trim(x, depth + 1))
  if (v && typeof v === "object") {
    const entries = Object.entries(v)
    const out = {}
    for (const [k, x] of entries.slice(0, depth > 2 ? 8 : 30)) out[k] = trim(x, depth + 1)
    if (entries.length > (depth > 2 ? 8 : 30)) out["…"] = `${entries.length - 8} more fields`
    return out
  }
  if (typeof v === "string" && v.length > 180) return v.slice(0, 177) + "…"
  return v
}

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

// Free tools, called live. Later examples can use earlier results (a product URL for the cart).
const FREE = [
  { name: "actuent_search", about: "Find sites, pages and products for a query or a domain. Results say why they matched.", args: { query: "running shoes" } },
  { name: "actuent_search", title: "actuent_search (another language)", about: "Queries in other languages are translated first, so German, French, Danish… searches find the same sites.", args: { query: "passwort-manager" } },
  { name: "actuent_get_actions", about: "What an agent can do on a site: actions, their inputs, and whether they can be executed.", args: { domain: "basecamp.com" } },
  { name: "actuent_get_page", about: "One page of a site, as clean text an agent can read.", args: { url: "basecamp.com/pricing" } },
  { name: "actuent_summarise", about: "A short summary of a site: what it is, its key pages and actions.", args: { domain: "stripe.com" } },
  { name: "actuent_ask_site", about: "Answers a question from a site's own pages, with the pages it used.", args: { domain: "basecamp.com", question: "How much does it cost?" } },
  { name: "actuent_compare", about: "Compares sites side by side (or products, with urls).", args: { domains: ["asana.com", "trello.com"] } },
  { name: "actuent_nearby", about: "Places near a location from OpenStreetMap, with opening hours and whether they're open now.", args: { query: "coffee", location: "Nørrebro, Copenhagen", radius_metres: 800 } },
  { name: "actuent_find_service", about: "Services and dishes with prices from businesses' own sites, within a budget.", args: { query: "yoga class" } },
  { name: "actuent_events", about: "Upcoming events that venues and organisers publish on their sites.", args: { max_results: 3 } },
  { name: "actuent_plan", about: "An evening or a day out: stops in order, near each other, open at the right times.", args: { location: "Vesterbro, Copenhagen", stops: ["dinner", "drinks"], start_time: "19:00" } },
  { name: "actuent_trip", about: "A 1–4 day city trip: what to see, where to eat, and events on those days.", args: { location: "Lisbon", days: 2 } },
  { name: "actuent_cart", about: "A ready checkout link for Shopify products, so the user only confirms and pays.", args: null },
  { name: "actuent_trending", about: "What agents are searching for, and the sites they find most, over the last 7 days.", args: { type: "sites" } },
  { name: "actuent_news", about: "Recent news on a topic from indexed news sites.", args: { topic: "AI agents" } }
]

// Pro tools: request plus the fields the response has (from the tool's implementation).
const PRO = [
  { name: "actuent_execute_action", about: "Runs an action on a site that publishes its own LAWP. Actions that cost money or can't be undone need <code>confirmed: true</code> after the user agrees; <code>mode: \"quote\"</code> gets a price without doing anything.", args: { domain: "api.actuent.ai", action_id: "suggest_site", input: { domain: "example.com" }, mode: "execute" }, fields: ["executed", "status", "response", "safety", "status_url (for actions that finish later)", "needs_confirmation (with a summary to show the user)"] },
  { name: "actuent_action_status", about: "Checks an action that finishes later (HTTP 202).", args: { domain: "example.com", status_url: "https://example.com/lawp/status/123" }, fields: ["status (pending, done, failed)", "result"] },
  { name: "actuent_accounts", about: "The user's accounts on sites (OAuth), for actions that need one.", args: { action: "list" }, fields: ["connections: domain, connected_at", "connect_url (for action: connect)"] },
  { name: "actuent_history", about: "Your recent searches.", args: { limit: 5 }, fields: ["searches: query, domains, created_at"] },
  { name: "actuent_watch_price", about: "Emails you (and optionally POSTs to a webhook) when a product's price drops or it's back in stock.", args: { action: "watch", url: "https://shop.example.com/products/trail-runner", target_price_eur: 90 }, fields: ["watching", "current_price_eur", "how"] }
]

async function main() {
  const results = []
  let productUrl = null
  for (const t of FREE) {
    let args = t.args
    if (t.name === "actuent_cart") {
      if (!productUrl) { console.log("skip actuent_cart: no Shopify product found"); continue }
      args = { items: [{ url: productUrl, quantity: 1 }] }
    }
    const started = Date.now()
    const response = await call(t.name, args).catch(e => ({ error: String(e) }))
    if (t.name === "actuent_search" && !productUrl) productUrl = (response?.products || []).find(p => /\/products\//.test(p.url))?.url || null
    console.log(`${t.name}: ${Date.now() - started} ms`)
    results.push({ ...t, args, response: trim(response), ms: Date.now() - started })
  }

  const style = fs.readFileSync(path.join(root, "guides.html"), "utf8").match(/<style>([\s\S]*?)<\/style>/)[1]
  const generated = new Date().toISOString().slice(0, 10)
  const request = (name, args) => JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, null, 2)
  const section = r => `<h2 id="${esc(r.title ? r.name + "-2" : r.name)}">${esc(r.title || r.name)}</h2>
<p>${r.about}</p>
<h3>Request</h3><pre><code>${esc(request(r.name, r.args))}</code></pre>
<h3>Response <span style="color:#8e8e9c;font-weight:400">(live, ${r.ms} ms, trimmed)</span></h3><pre><code>${esc(JSON.stringify(r.response, null, 2))}</code></pre>`
  const proSection = r => `<h2 id="${esc(r.name)}">${esc(r.name)} <span style="font-size:12px;color:#ff8a3d;font-weight:600">PRO</span></h2>
<p>${r.about}</p>
<h3>Request</h3><pre><code>${esc(request(r.name, r.args))}</code></pre>
<h3>Response fields</h3><ul>${r.fields.map(f => `<li><code>${esc(f.split(" ")[0])}</code>${esc(f.slice(f.split(" ")[0].length))}</li>`).join("")}</ul>`

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tool Examples — Actuent</title>
  <meta name="description" content="A real request and response for every Actuent MCP tool, from live calls.">
  <link rel="icon" type="image/png" href="https://api.actuent.ai/assets/actuent-logo.png">
  <link rel="canonical" href="https://docs.actuent.ai/examples">
  <meta property="og:title" content="Tool Examples — Actuent">
  <meta property="og:description" content="A real request and response for every Actuent MCP tool.">
  <meta property="og:url" content="https://docs.actuent.ai/examples">
  <meta property="og:image" content="https://api.actuent.ai/og?v=2&title=Tool%20Examples&amp;subtitle=A%20real%20request%20and%20response%20for%20every%20tool&amp;tag=docs.actuent.ai%2Fexamples">
  <meta name="twitter:card" content="summary_large_image">
  <style>${style}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<main id="main">
  <div class="top"><a href="https://actuent.ai"><img src="https://api.actuent.ai/assets/actuent-logo.png" alt="Actuent"></a><span><a href="/">Docs</a><a href="/guides">Guides</a><a href="/generator">Generator</a></span></div>
  <h1>Tool examples</h1>
  <p class="sub">A real request and response for every tool on <code>https://agents.actuent.ai/api/mcp</code>, called live on ${generated} without an API key (free tier). Lists are cut to two items and long text is shortened. Pro tools show the request and the fields you get back.</p>
  <div class="toc">${[...results.map(r => `<a href="#${esc(r.title ? r.name + "-2" : r.name)}">${esc(r.title ? r.name + " (language)" : r.name)}</a>`), ...PRO.map(r => `<a href="#${esc(r.name)}">${esc(r.name)}</a>`)].join("")}</div>
  <div class="note"><p>Every call is JSON-RPC 2.0 over HTTP POST. With an API key, add <code>Authorization: Bearer ak_live_…</code> for Pro limits and tools. Connecting from ChatGPT, Claude or Cursor sends these requests for you.</p></div>
${results.map(section).join("\n")}
${PRO.map(proSection).join("\n")}
</main>
</body>
</html>
`
  fs.writeFileSync(path.join(root, "examples.html"), html)
  console.log(`examples.html: ${results.length} live examples, ${PRO.length} Pro tools`)
}

main().catch(e => { console.error(e); process.exit(1) })
