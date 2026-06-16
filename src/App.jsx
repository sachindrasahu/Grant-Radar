import { useState, useEffect, useCallback } from "react";

// ───────────────────────────────────────────────────────────────
// Grant & RFP Radar — Enira / Ropan  (shared, admin-controlled)
//
// • ONE shared source list = Enira's institutional memory.
// • Anyone can PROPOSE a source; it waits in a pending queue.
// • Only the ADMIN (code-gated) can approve/reject proposals and
//   remove sources. The admin code is set by the admin on first use.
// • Listings are verified live; unconfirmed → Quarantine; past → Archive.
//
// Shared data is stored server-side (Vercel KV) via /api/store, so all
// teammates share one list. The admin-unlocked flag is per-device (localStorage).
// ───────────────────────────────────────────────────────────────

const FOCUS = "health, sustainability, medtech, public health, climate";

const SEED_AGENCIES = [
  { name: "Grand Challenges (Gates Foundation)", url: "https://www.grandchallenges.org/grant-opportunities" },
  { name: "BIRAC / Grand Challenges India", url: "https://birac.nic.in/cfp.php" },
  { name: "Dept. of Biotechnology (DBT)", url: "https://dbt.gov.in/" },
  { name: "ICMR", url: "https://www.icmr.gov.in/tenders" },
  { name: "ANRF (Anusandhan NRF)", url: "https://anrfonline.in/ANRF/arg_anrf" },
  { name: "DST – India", url: "https://dst.gov.in/callforproposals" },
  { name: "Wellcome Trust – contract opportunities", url: "https://wellcome.org/about-us/work-with-us/contract-opportunities" },
  { name: "WHO – calls for proposals", url: "https://www.who.int/news-room/articles" },
  { name: "DevNetJobs India (RFPs/tenders)", url: "https://www.devnetjobsindia.org/" },
  { name: "DevelopmentAid (grants/tenders)", url: "https://www.developmentaid.org/tenders" },
  { name: "DIV Fund (USAID)", url: "https://www.div.fund/apply/rfp" },
  { name: "COR-NTD funding", url: "https://www.cor-ntd.org/funding-opportunities" },
  { name: "Blockchain For Impact (BFI)", url: "https://www.blockchainforimpact.in/" },
];

const K_SOURCES = "radar:sources";      // shared approved source list
const K_PENDING = "radar:pending";       // shared proposal queue
const K_ITEMS = "radar:items";           // shared scanned listings
const K_META = "radar:meta";             // shared { lastScan, adminHash }
const K_LOCAL_ADMIN = "radar:localAdmin"; // personal: is this browser unlocked

const norm = (s) => (s || "").toLowerCase().trim();
const itemKey = (g) => `${norm(g.title)}::${norm(g.funder)}`;
const srcKey = (s) => norm(s.name);

// Tiny non-cryptographic hash so the raw admin code is never stored.
// (Lightweight gate — deters honest edits, not a determined attacker.)
function hashCode(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return String(h);
}

function daysLeft(deadline) {
  if (!deadline || deadline === "rolling" || deadline === "unknown") return null;
  const t = Date.parse(deadline);
  if (isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86400000);
}

function parseItems(text) {
  if (!text) return null;
  let s = text.replace(/```json/gi, "").replace(/```/g, "");
  const start = s.indexOf("[");
  if (start === -1) return null;
  s = s.slice(start);
  const end = s.lastIndexOf("]");
  if (end !== -1) { try { const a = JSON.parse(s.slice(0, end + 1)); if (Array.isArray(a)) return a; } catch (e) {} }
  const objs = [];
  let depth = 0, os = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") { if (depth === 0) os = i; depth++; }
    else if (c === "}") { depth--; if (depth === 0 && os !== -1) { try { objs.push(JSON.parse(s.slice(os, i + 1))); } catch (e) {} os = -1; } }
  }
  return objs.length ? objs : null;
}

// Shared data now lives in Vercel KV via /api/store (all teammates share it).
async function sget(key) {
  try {
    const r = await fetch(`/api/store?key=${encodeURIComponent(key)}`);
    if (!r.ok) return null;
    const d = await r.json();
    return d.value || null;
  } catch (e) { return null; }
}
async function sset(key, val) {
  try {
    await fetch("/api/store", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value: val }),
    });
  } catch (e) {}
}
// The "is this browser unlocked as admin" flag is per-device, so it stays local.
function localGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function localSet(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }

function Chip({ kind, children }) { return <span className={`chip ${kind || ""}`}>{children}</span>; }

function Deadline({ deadline }) {
  if (!deadline || deadline === "rolling") return <Chip kind="mono">Rolling / open</Chip>;
  if (deadline === "unknown") return <Chip kind="mono dim">Deadline unconfirmed</Chip>;
  const d = daysLeft(deadline);
  if (d === null) return <Chip kind="mono">{deadline}</Chip>;
  if (d < 0) return <Chip kind="mono dim">Closed · {deadline}</Chip>;
  return <Chip kind={`mono ${d <= 14 ? "urgent" : ""}`}>{d === 0 ? "Closes today" : `${d} days left`} · {deadline}</Chip>;
}

export default function GrantRfpRadar() {
  const [sources, setSources] = useState([]);
  const [pending, setPending] = useState([]);
  const [items, setItems] = useState([]);
  const [adminHash, setAdminHash] = useState(null); // shared: set once by admin
  const [isAdmin, setIsAdmin] = useState(false);     // local: this browser unlocked
  const [lastScan, setLastScan] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const [tab, setTab] = useState("live");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);

  // propose form (everyone)
  const [pName, setPName] = useState("");
  const [pUrl, setPUrl] = useState("");
  const [pBy, setPBy] = useState("");
  // admin code fields
  const [codeInput, setCodeInput] = useState("");
  const [newCode, setNewCode] = useState("");

  // ── load shared + local state ──
  useEffect(() => {
    (async () => {
      const [s, p, it, meta] = await Promise.all([
        sget(K_SOURCES), sget(K_PENDING), sget(K_ITEMS), sget(K_META),
      ]);
      const localAdmin = localGet(K_LOCAL_ADMIN);
      const safeParse = (str) => { try { const v = JSON.parse(str); return Array.isArray(v) ? v : null; } catch(e) { return null; } };
      const parsedSources = s ? safeParse(s) : null;
      if (parsedSources && parsedSources.length) setSources(parsedSources); else { setSources(SEED_AGENCIES); await sset(K_SOURCES, JSON.stringify(SEED_AGENCIES)); }
      const parsedPending = p ? safeParse(p) : null;
      if (parsedPending) setPending(parsedPending);
      const parsedItems = it ? safeParse(it) : null;
      if (parsedItems) setItems(parsedItems);
      try { if (meta) { const m = JSON.parse(meta); setAdminHash(m.adminHash || null); setLastScan(m.lastScan || null); } } catch(e) {}
      if (localAdmin === "yes") setIsAdmin(true);
      setLoaded(true);
    })();
  }, []);

  const saveMeta = useCallback(async (patch) => {
    const cur = { adminHash, lastScan };
    const next = { ...cur, ...patch };
    if ("adminHash" in patch) setAdminHash(patch.adminHash);
    if ("lastScan" in patch) setLastScan(patch.lastScan);
    await sset(K_META, JSON.stringify(next));
  }, [adminHash, lastScan]);

  // ── scanning — batched to avoid web_search rate limits ──
  async function scanBatch(batch, batchNum, totalBatches) {
    const sourceList = batch.map((a, i) => {
      const hint = a.url ? `URL hint: ${a.url}` : `no URL — search by name`;
      return `${i + 1}. "${a.name}" (${hint})`;
    }).join("\n");

    const prompt = `Using web search, find currently open funding opportunities, grants, RFPs, or tenders from EACH of the following funders, open to organizations BASED IN INDIA, relating to ${FOCUS}.

Sources to check:
${sourceList}

Search each funder separately. For each opportunity found, VERIFY it is currently open (not expired). Output ONLY a raw JSON array (no markdown/prose/fences). Each object has exactly:
"title", "funder" (exact funder name from the list above), "type" (one of "Grant","RFP","Tender","Fellowship","Other"), "deadline" (ISO YYYY-MM-DD, or "rolling", or "unknown"), "amount" (short or "unknown"), "focus" (short), "india_eligible" (one of "yes","check","no"), "verified" (one of "live","unconfirmed" — "live" ONLY if clearly open with a future or rolling deadline), "summary" (2 sentences max), "link" (exact URL found — NEVER invent; if not found use official homepage and mark "unconfirmed").

Do not fabricate. Find none for a funder → omit it. Return [] if nothing found across all.`;

    setProgress(`Scanning batch ${batchNum}/${totalBatches} (${batch.map(a => a.name).join(", ")})`);
    const res = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return parseItems(data.text || "") || [];
  }

  async function scan() {
    setScanning(true); setError(""); setStatus("");
    const existing = new Map(items.map((g) => [itemKey(g), g]));
    let merged = items.map((g) => ({ ...g, isNew: false }));
    let newCount = 0, found = 0, failed = 0;
    const BATCH_SIZE = 4;
    const batches = [];
    for (let i = 0; i < sources.length; i += BATCH_SIZE) batches.push(sources.slice(i, i + BATCH_SIZE));
    try {
      for (let b = 0; b < batches.length; b++) {
        if (b > 0) await new Promise(r => setTimeout(r, 5000));
        let results = [];
        try {
          results = await scanBatch(batches[b], b + 1, batches.length);
          setProgress(`Batch ${b + 1}/${batches.length} done — ${results.length} found`);
        } catch (e) { failed += batches[b].length; setProgress(`Batch ${b + 1}/${batches.length} failed: ${e.message}`); await new Promise(r => setTimeout(r, 2000)); continue; }
        for (const r of results) {
          if (!r || !r.title || !r.link) continue;
          found++;
          const k = itemKey(r);
          const rec = { ...r, foundAt: existing.get(k)?.foundAt || new Date().toISOString() };
          if (!existing.has(k)) { merged.unshift({ ...rec, isNew: true }); existing.set(k, rec); newCount++; }
          else { const idx = merged.findIndex((g) => itemKey(g) === k); if (idx >= 0) merged[idx] = { ...merged[idx], ...rec, isNew: false }; }
        }
      }
      const capped = merged.slice(0, 200);
      setItems(capped);
      await sset(K_ITEMS, JSON.stringify(capped));
      await saveMeta({ lastScan: new Date().toISOString() });
      const failNote = failed > 0 ? ` · ${failed} sources skipped` : "";
      setStatus(found === 0 ? "Scan complete — nothing verifiable found this round." : `${newCount} new · ${found} confirmed across sources${failNote}`);
    } catch (e) { setError(e.message || "Scan failed — please try again."); }
    setProgress(""); setScanning(false);
  }

  // ── proposals (everyone) ──
  async function propose() {
    const name = pName.trim(), url = pUrl.trim(), by = pBy.trim();
    if (!name) { setError("Add a source name to propose."); return; }
    if (url && !/^https?:\/\//.test(url)) { setError("If you add a URL, start it with https://"); return; }
    if (sources.some((s) => srcKey(s) === norm(name)) || pending.some((s) => srcKey(s) === norm(name))) {
      setError("That source is already in the list or already proposed."); return;
    }
    setError("");
    const entry = { name, ...(url ? { url } : {}), by: by || "anonymous", at: new Date().toISOString() };
    const next = [...pending, entry];
    setPending(next); setPName(""); setPUrl(""); setPBy("");
    await sset(K_PENDING, JSON.stringify(next));
    setStatus("Proposal submitted — it will appear once the admin approves it.");
  }

  // ── admin actions ──
  async function unlockAdmin() {
    const code = codeInput.trim();
    if (!code) return;
    if (!adminHash) {
      // first launch: this becomes the admin code
      await saveMeta({ adminHash: hashCode(code) });
      setIsAdmin(true); localSet(K_LOCAL_ADMIN, "yes");
      setCodeInput(""); setStatus("Admin code set. You now have admin controls on this device.");
    } else if (hashCode(code) === adminHash) {
      setIsAdmin(true); localSet(K_LOCAL_ADMIN, "yes");
      setCodeInput(""); setError("");
    } else { setError("That code doesn't match."); }
  }
  async function lockAdmin() { setIsAdmin(false); localSet(K_LOCAL_ADMIN, "no"); }

  async function approve(i) {
    const p = pending[i];
    const nextSources = [...sources, { name: p.name, ...(p.url ? { url: p.url } : {}) }];
    const nextPending = pending.filter((_, idx) => idx !== i);
    setSources(nextSources); setPending(nextPending);
    await sset(K_SOURCES, JSON.stringify(nextSources));
    await sset(K_PENDING, JSON.stringify(nextPending));
  }
  async function reject(i) {
    const nextPending = pending.filter((_, idx) => idx !== i);
    setPending(nextPending);
    await sset(K_PENDING, JSON.stringify(nextPending));
  }
  async function removeSource(i) {
    const next = sources.filter((_, idx) => idx !== i);
    setSources(next);
    await sset(K_SOURCES, JSON.stringify(next));
  }

  const isPast = (g) => { const d = daysLeft(g.deadline); return d !== null && d < 0; };
  const live = items.filter((g) => !isPast(g) && g.verified === "live");
  const quarantine = items.filter((g) => !isPast(g) && g.verified !== "live");
  const archive = items.filter(isPast);
  const newCount = items.filter((g) => g.isNew && !isPast(g)).length;
  const shown = tab === "live" ? live : tab === "quarantine" ? quarantine : tab === "archive" ? archive : [];

  return (
    <div className="root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box}
        .root{min-height:100vh;background:#FBFAF7;color:#1A2421;font-family:'Inter',sans-serif}
        .wrap{max-width:900px;margin:0 auto;padding:0 20px}
        .hero{background:linear-gradient(160deg,#143C2E 0%,#0E2E23 100%);color:#F4F2EC;padding:34px 0 26px}
        .kbrand{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.22em;text-transform:uppercase;opacity:.6;margin-bottom:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
        .pill{background:rgba(244,242,236,.14);border-radius:99px;padding:2px 9px;font-size:10px;letter-spacing:.08em}
        .pill.on{background:#C9A24B;color:#1A1402}
        .hero h1{font-family:'Fraunces',serif;font-weight:600;font-size:clamp(27px,4vw,40px);margin:0;line-height:1.05;letter-spacing:-.5px}
        .hero h1 em{font-style:italic;color:#C9A24B}
        .hero p{margin:10px 0 0;opacity:.8;font-size:14px;max-width:580px;line-height:1.55}
        .bar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:20px}
        .scan{background:#C9A24B;color:#1A1402;border:none;font-weight:600;font-size:14.5px;padding:12px 22px;border-radius:7px;cursor:pointer;transition:transform .15s,background .15s}
        .scan:hover{transform:translateY(-1px);background:#D6B05A}
        .scan:disabled{opacity:.6;cursor:wait;transform:none}
        .meta{font-family:'IBM Plex Mono',monospace;font-size:11.5px;opacity:.72}
        .prog{font-family:'IBM Plex Mono',monospace;font-size:11.5px;color:#C9A24B}
        .tabs{display:flex;gap:4px;flex-wrap:wrap;margin:22px 0 18px;border-bottom:1px solid #E6E2D8}
        .tab{background:none;border:none;border-bottom:2px solid transparent;color:#5A6B62;padding:10px 14px;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:-1px}
        .tab.active{color:#143C2E;border-bottom-color:#C9A24B}
        .tab .n{font-family:'IBM Plex Mono',monospace;font-size:11px;opacity:.7;margin-left:5px}
        .badge{background:#C9A24B;color:#1A1402;border-radius:99px;font-size:10px;font-weight:700;padding:1px 6px;margin-left:6px;font-family:'IBM Plex Mono',monospace}
        .badge.q{background:#E8D8A8}
        .card{background:#fff;border:1px solid #E6E2D8;border-radius:11px;padding:17px 19px;margin-bottom:11px;cursor:pointer;transition:border-color .15s,box-shadow .15s}
        .card:hover{border-color:#143C2E;box-shadow:0 2px 14px rgba(20,60,46,.06)}
        .card.new{border-left:4px solid #C9A24B}
        .ctop{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
        .card h3{font-family:'Fraunces',serif;font-size:17.5px;font-weight:600;margin:0 0 3px;line-height:1.3}
        .funder{font-size:12.5px;color:#5A6B62;font-weight:500;margin-bottom:11px}
        .newtag{font-family:'IBM Plex Mono',monospace;font-size:9.5px;font-weight:700;background:#C9A24B;color:#1A1402;padding:2px 6px;border-radius:4px;letter-spacing:.06em;white-space:nowrap}
        .chips{display:flex;gap:7px;flex-wrap:wrap}
        .chip{font-size:11.5px;background:#F0EEE6;border-radius:6px;padding:4px 9px;color:#33433B}
        .chip.mono{font-family:'IBM Plex Mono',monospace}
        .chip.urgent{background:#F6E2C7;color:#7A4B07;font-weight:600}
        .chip.dim{opacity:.6}
        .chip.type{background:#E1ECE5;color:#1C5235;font-weight:600}
        .chip.elig-yes{background:#DCEFE0;color:#1C5733;font-weight:600}
        .chip.elig-no{background:#F2DAD6;color:#7A2415;font-weight:600}
        .chip.elig-check{background:#F8F0D6;color:#7A5B07;font-weight:600}
        .detail{margin-top:14px;border-top:1px dashed #E0DCD0;padding-top:13px;font-size:13.5px;line-height:1.6;color:#2A332E}
        .detail b{font-family:'IBM Plex Mono',monospace;font-size:10.5px;text-transform:uppercase;letter-spacing:.09em;color:#5A6B62;display:block;margin-bottom:2px;font-weight:500}
        .sec{margin-bottom:11px}
        .apply{display:inline-flex;align-items:center;gap:6px;background:#143C2E;color:#F4F2EC;text-decoration:none;font-weight:600;font-size:13.5px;padding:10px 17px;border-radius:7px}
        .apply:hover{background:#1B5240}
        .empty{text-align:center;padding:52px 20px;color:#6A7A70}
        .empty h3{font-family:'Fraunces',serif;color:#1A2421;font-size:19px;margin:0 0 7px}
        .empty p{font-size:13.5px;max-width:440px;margin:0 auto;line-height:1.6}
        .note{font-size:12px;color:#6A7A70;margin-top:16px;line-height:1.55}
        .srcrow{display:flex;align-items:center;justify-content:space-between;gap:12px;background:#fff;border:1px solid #E6E2D8;border-radius:9px;padding:11px 15px;margin-bottom:8px}
        .srcrow .nm{font-size:13.5px;font-weight:600}
        .srcrow .ur{font-size:11.5px;color:#6A7A70;font-family:'IBM Plex Mono',monospace;word-break:break-all}
        .srcrow .byline{font-size:11px;color:#8A968E;margin-top:2px}
        .rm{background:none;border:none;color:#A33;cursor:pointer;font-size:12.5px;font-weight:600;white-space:nowrap}
        .btnrow{display:flex;gap:7px}
        .ap{background:#143C2E;color:#fff;border:none;border-radius:6px;padding:7px 13px;font-size:12.5px;font-weight:600;cursor:pointer}
        .rj{background:#fff;color:#A33;border:1px solid #E3C9C3;border-radius:6px;padding:7px 13px;font-size:12.5px;font-weight:600;cursor:pointer}
        .addbox{background:#fff;border:1px solid #E6E2D8;border-radius:10px;padding:15px;margin-top:14px}
        .addbox input{width:100%;border:1px solid #D8D3C7;border-radius:7px;padding:9px 12px;font-size:13.5px;font-family:'Inter',sans-serif;margin-bottom:8px}
        .addbox input:focus{outline:2px solid #C9A24B;border-color:transparent}
        .addbtn{background:#143C2E;color:#fff;border:none;border-radius:7px;padding:9px 18px;font-weight:600;font-size:13.5px;cursor:pointer}
        .err{background:#F6E2DD;color:#7A2415;border-radius:8px;padding:11px 15px;font-size:13px;margin-bottom:14px}
        .ok{background:#DCEFE0;color:#1C5733;border-radius:8px;padding:11px 15px;font-size:13px;margin-bottom:14px}
        .qbanner{background:#F8F0D6;border:1px solid #E8D8A8;border-radius:8px;padding:11px 15px;font-size:12.5px;color:#6B5310;margin-bottom:14px;line-height:1.5}
        .adminbox{background:#11302540;border:1px solid #D8D3C7;border-radius:10px;padding:15px;margin-top:18px}
        .adminbox h4{margin:0 0 4px;font-family:'Fraunces',serif;font-size:15px}
        .adminbox p{margin:0 0 10px;font-size:12.5px;color:#5A6B62;line-height:1.5}
        .adminbox input{border:1px solid #D8D3C7;border-radius:7px;padding:9px 12px;font-size:13.5px;margin-right:8px;width:200px;max-width:60%}
        .secthead{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#5A6B62;margin:22px 0 10px}
        @media(prefers-reduced-motion:reduce){*{transition:none!important}}
      `}</style>

      <div className="hero">
        <div className="wrap">
          <div className="kbrand">
            <span>Enira · Ropan — funding intelligence</span>
            <span className={`pill ${isAdmin ? "on" : ""}`}>{isAdmin ? "admin" : "team view"}</span>
          </div>
          <h1>Grant &amp; RFP <em>Radar</em></h1>
          <p>One shared, vetted list of health and sustainability funders open to India. Anyone can propose a source; the admin approves what joins the list. Listings are verified live — unconfirmed wait in Quarantine, closed ones move to Archive.</p>
          <div className="bar">
            <button className="scan" onClick={scan} disabled={scanning || !loaded}>
              {scanning ? "Scanning sources…" : "Scan for opportunities"}
            </button>
            {scanning && progress && <span className="prog">{progress}</span>}
            {!scanning && status && <span className="prog">{status}</span>}
            {!scanning && lastScan && <span className="meta">last scan {new Date(lastScan).toLocaleString()}</span>}
          </div>
        </div>
      </div>

      <div className="wrap">
        <div className="tabs">
          <button className={`tab ${tab === "live" ? "active" : ""}`} onClick={() => setTab("live")}>
            Live<span className="n">{live.length}</span>{newCount > 0 && <span className="badge">{newCount} new</span>}
          </button>
          <button className={`tab ${tab === "quarantine" ? "active" : ""}`} onClick={() => setTab("quarantine")}>
            Quarantine<span className="n">{quarantine.length}</span>
          </button>
          <button className={`tab ${tab === "archive" ? "active" : ""}`} onClick={() => setTab("archive")}>
            Archive<span className="n">{archive.length}</span>
          </button>
          <button className={`tab ${tab === "sources" ? "active" : ""}`} onClick={() => setTab("sources")}>
            Sources<span className="n">{sources.length}</span>
            {pending.length > 0 && <span className="badge q">{pending.length} pending</span>}
          </button>
        </div>

        {error && <div className="err">{error}</div>}
        {!error && status && tab === "sources" && <div className="ok">{status}</div>}

        {tab === "sources" ? (
          <div>
            <div className="secthead">Vetted sources · scanned every run</div>
            {sources.map((a, i) => (
              <div className="srcrow" key={i}>
                <div>
                  <div className="nm">{a.name}</div>
                  <div className="ur">{a.url || "searched by name"}</div>
                </div>
                {isAdmin && <button className="rm" onClick={() => removeSource(i)}>Remove</button>}
              </div>
            ))}

            {(pending.length > 0 || isAdmin) && (
              <div className="secthead">Pending proposals {isAdmin ? "· your review" : "· awaiting admin"}</div>
            )}
            {pending.map((p, i) => (
              <div className="srcrow" key={`p${i}`}>
                <div>
                  <div className="nm">{p.name}</div>
                  <div className="ur">{p.url || "searched by name"}</div>
                  <div className="byline">proposed by {p.by}</div>
                </div>
                {isAdmin && (
                  <div className="btnrow">
                    <button className="ap" onClick={() => approve(i)}>Approve</button>
                    <button className="rj" onClick={() => reject(i)}>Reject</button>
                  </div>
                )}
              </div>
            ))}

            <div className="addbox">
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 9 }}>Propose a new source</div>
              <input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Source name, e.g. Rockefeller Foundation" />
              <input value={pUrl} onChange={(e) => setPUrl(e.target.value)} placeholder="Funding page URL (optional)" />
              <input value={pBy} onChange={(e) => setPBy(e.target.value)} placeholder="Your name (optional)" />
              <button className="addbtn" onClick={propose}>Submit proposal</button>
            </div>
            <p className="note">Only the name is required — each scan searches by name and finds the funder's current page on its own, so a moved website won't break anything. Proposals wait here until the admin approves them, keeping the shared list clean. The seed list came from the team's existing grant and leads sheets.</p>

            <div className="adminbox">
              <h4>{isAdmin ? "Admin controls active" : adminHash ? "Admin sign-in" : "Set up admin"}</h4>
              <p>
                {isAdmin
                  ? "You can approve or reject proposals and remove sources on this device."
                  : adminHash
                  ? "Enter the admin code to unlock approve / reject / remove on this device."
                  : "No admin code is set yet. The first code entered here becomes the admin code — choose something only you know, and keep it safe (it can't be recovered)."}
              </p>
              {isAdmin ? (
                <button className="rj" onClick={lockAdmin}>Lock admin on this device</button>
              ) : (
                <div>
                  <input type="password" value={codeInput} onChange={(e) => setCodeInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && unlockAdmin()}
                    placeholder={adminHash ? "Admin code" : "Create admin code"} />
                  <button className="addbtn" onClick={unlockAdmin}>{adminHash ? "Unlock" : "Set code"}</button>
                </div>
              )}
            </div>
          </div>
        ) : tab === "quarantine" && shown.length > 0 ? (
          <>
            <div className="qbanner">These appeared in a search but couldn't be confirmed as currently open against their source. Treat as leads to check by hand — open the link and verify before investing time. Nothing here is guaranteed live.</div>
            <ItemList shown={shown} openId={openId} setOpenId={setOpenId} />
          </>
        ) : shown.length === 0 ? (
          <div className="empty">
            <h3>{tab === "live" ? "No verified-live listings yet" : tab === "quarantine" ? "Quarantine is empty" : "Nothing archived yet"}</h3>
            <p>
              {tab === "live"
                ? "Hit “Scan for opportunities” above. The tracker checks each source live and only lands a listing here once it confirms the call is open and India-eligible."
                : tab === "quarantine"
                ? "Listings that can't be verified against their source collect here for manual review."
                : "Once a tracked listing passes its deadline, it moves here automatically so your Live feed stays current."}
            </p>
          </div>
        ) : (
          <ItemList shown={shown} openId={openId} setOpenId={setOpenId} />
        )}
      </div>
    </div>
  );
}

function ItemList({ shown, openId, setOpenId }) {
  const eligMap = { yes: ["elig-yes", "India eligible"], no: ["elig-no", "India excluded"], check: ["elig-check", "Check eligibility"] };
  return (
    <div>
      {shown.map((g) => {
        const id = itemKey(g);
        const open = openId === id;
        const e = eligMap[g.india_eligible];
        return (
          <div key={id} className={`card ${g.isNew ? "new" : ""}`} onClick={() => setOpenId(open ? null : id)}>
            <div className="ctop">
              <div>
                <h3>{g.title}</h3>
                <div className="funder">{g.funder}</div>
              </div>
              {g.isNew && <span className="newtag">NEW</span>}
            </div>
            <div className="chips">
              {g.type && <Chip kind="type">{g.type}</Chip>}
              <Deadline deadline={g.deadline} />
              {e && <Chip kind={e[0]}>{e[1]}</Chip>}
              {g.amount && g.amount !== "unknown" && <Chip>{g.amount}</Chip>}
              {g.focus && <Chip>{g.focus}</Chip>}
            </div>
            {open && (
              <div className="detail" onClick={(ev) => ev.stopPropagation()}>
                {g.summary && <div className="sec"><b>Summary</b>{g.summary}</div>}
                {g.link && <a className="apply" href={g.link} target="_blank" rel="noreferrer">Open application page ↗</a>}
              </div>
            )}
          </div>
        );
      })}
      <p className="note">Listings are checked against their live source at scan time. Always confirm the deadline and eligibility on the source page before preparing a submission.</p>
    </div>
  );
}
