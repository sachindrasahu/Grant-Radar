// /api/store — shared team data, backed by Vercel KV (Upstash Redis).
// GET  /api/store?key=radar:sources        → { value }
// POST /api/store   body { key, value }     → { ok: true }
//
// This is the shared layer that replaces the artifact's window.storage.
// All teammates read/write the same keys, so everyone sees one list.
//
// Requires the Vercel KV integration (env vars KV_REST_API_URL and
// KV_REST_API_TOKEN are injected automatically when you add KV).

const URL_BASE = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;

// Only these keys are allowed, so the endpoint can't be abused as
// a general-purpose open database.
const ALLOWED = new Set(["radar:sources", "radar:pending", "radar:items", "radar:meta"]);

async function kv(path, opts) {
  const r = await fetch(`${URL_BASE}/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(opts && opts.headers) },
  });
  return r.json();
}

export default async function handler(req, res) {
  if (!URL_BASE || !TOKEN) {
    return res.status(500).json({ error: "KV not configured. Add the Vercel KV integration to this project." });
  }

  if (req.method === "GET") {
    const key = req.query.key;
    if (!ALLOWED.has(key)) return res.status(400).json({ error: "Unknown key" });
    try {
      const out = await kv(`get/${encodeURIComponent(key)}`, { method: "GET" });
      // KV returns { result: "<stored string>" } or { result: null }
      return res.status(200).json({ value: out && out.result ? out.result : null });
    } catch (e) {
      return res.status(500).json({ error: e.message || "KV read failed" });
    }
  }

  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: "Bad body" }); } }
    const { key, value } = body || {};
    if (!ALLOWED.has(key)) return res.status(400).json({ error: "Unknown key" });
    if (typeof value !== "string") return res.status(400).json({ error: "value must be a string" });
    if (value.length > 4_500_000) return res.status(413).json({ error: "value too large" });
    try {
      await kv(`set/${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message || "KV write failed" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
