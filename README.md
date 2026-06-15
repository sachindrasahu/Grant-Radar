# Grant & RFP Radar — Deploy Guide

This is your team's funding tracker, ready to go live on Vercel. Follow the
steps in order. No prior deployment experience needed — each step says exactly
what to click. Total time: about 20–30 minutes the first time.

There are three things to set up:
1. The app itself (the website your team opens)
2. Your Anthropic API key (so scans work, kept safely server-side)
3. Vercel KV (the shared database so everyone sees one list)

---

## What you need before starting

- Your Vercel account (you have this).
- An Anthropic API key. Get one at https://console.anthropic.com → "API Keys"
  → "Create Key". Copy it somewhere safe; it looks like `sk-ant-...`.
- A free GitHub account (easiest path) OR the Vercel CLI. This guide uses
  GitHub because it's the simplest to follow with screenshots on Vercel's site.

---

## Step 1 — Put this folder on GitHub

1. Go to https://github.com/new and create a new **private** repository called
   `grant-radar`. Don't add a README (this folder already has one).
2. On your computer, open a terminal **inside this `grant-radar` folder** and run:

   ```
   git init
   git add .
   git commit -m "Grant Radar v1"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/grant-radar.git
   git push -u origin main
   ```

   Replace `YOUR-USERNAME` with your GitHub username. If git asks you to log in,
   follow its prompts.

   (No terminal? GitHub Desktop — https://desktop.github.com — can do the same
   with buttons: "Add existing repository", point it at this folder, "Publish".)

---

## Step 2 — Import the project into Vercel

1. Go to https://vercel.com/new
2. Find `grant-radar` in the list of your GitHub repos and click **Import**.
3. Vercel auto-detects it's a Vite app. Leave all build settings as their
   defaults (Framework Preset: Vite, Build Command: `vite build`, Output: `dist`).
4. **Do not click Deploy yet.** First expand **Environment Variables** and add
   your Anthropic key (next step).

---

## Step 3 — Add your Anthropic API key

Still on the import screen (or later under Project → Settings →
Environment Variables):

1. Add a variable:
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** paste your `sk-ant-...` key
2. Leave it applied to all environments (Production, Preview, Development).
3. Save.

This key lives only on Vercel's servers. It powers the `/api/scan` function and
is never sent to anyone's browser — which is the whole reason we use a relay.

Now click **Deploy**. Wait for it to finish (1–2 minutes). You'll get a URL like
`grant-radar.vercel.app`. The page will load, but **scanning won't fully work
until you add the database in Step 4.**

---

## Step 4 — Add Vercel KV (the shared database)

This is what makes the list shared across your whole team.

1. In your project on Vercel, open the **Storage** tab.
2. Click **Create Database** → choose **KV** (Redis / key-value).
3. Give it any name (e.g. `grant-radar-kv`), pick the region closest to your
   team, and create it.
4. When asked, **connect it to this project**. This automatically adds two
   environment variables (`KV_REST_API_URL` and `KV_REST_API_TOKEN`) — you don't
   type these yourself.
5. Go to the **Deployments** tab → on the most recent deployment, click the
   "..." menu → **Redeploy**. This picks up the new database connection.

That's it. Scans now work and all teammates share one list.

---

## Step 5 — Become the admin

1. Open your live URL and go to the **Sources** tab.
2. Scroll to the **Set up admin** box at the bottom.
3. Type a code only you know and click **Set code**. The first code ever entered
   becomes the permanent admin code, so do this before sharing the link.
   - Keep it safe — it can't be recovered. If you ever lose it, see
     "Resetting the admin code" below.
4. You'll now see the **admin** badge and get Approve / Reject / Remove controls.

---

## Step 6 — Share with your team

Send colleagues the live URL. They can scan and view everything and **propose**
new sources, but only you (with the admin code) can approve proposals or remove
sources. Tell them NOT to enter anything in the admin box — if someone does it
before you set your code, the first thing typed becomes the admin code.

---

## How it all fits together (for reference)

- `src/App.jsx` — the app your team sees.
- `api/scan.js` — server-side relay to Anthropic; holds your API key.
- `api/store.js` — shared read/write to Vercel KV; the team's one list.
- The four shared keys are `radar:sources`, `radar:pending`, `radar:items`,
  `radar:meta`. Nothing else can be written through the store endpoint.

---

## Common questions

**Scans return nothing / errors.** Open the live site, then your browser's
developer console (F12 → Console) and run a scan. If you see a 500 about
`ANTHROPIC_API_KEY`, the key wasn't saved — recheck Step 3 and redeploy. If you
see an error about KV, recheck Step 4 and redeploy.

**"No verified-live listings yet" after a clean scan.** That's the verification
working — it only promotes opportunities it can confirm are currently open.
Check the Quarantine tab for leads it couldn't confirm, and sharpen source URLs.

**Resetting the admin code.** In Vercel → Storage → your KV database → open the
data browser, find the key `radar:meta`, and delete it (or edit out the
`adminHash` field). The next code entered in the app becomes the new admin code.
Your sources and listings are stored under separate keys and are unaffected.

**Costs.** Vercel's Hobby tier and KV free tier cover a small team's usage.
Anthropic API usage is billed per scan on your Anthropic account — a scan across
~15 sources is inexpensive, but you control spend by how often you scan.

**Updating the app later.** Make changes, `git commit`, `git push`. Vercel
redeploys automatically on every push to `main`.

---

## Security note (please read once)

The admin code is a **lightweight gate**. It's stored only as a hash and it
stops colleagues from casually or accidentally editing the shared list — the
real risk you wanted to prevent. It is **not** strong authentication: someone
technical and determined could work around it. When you outgrow that, the
upgrade is real per-user login (e.g. Vercel's auth, or Clerk/Auth0) gating the
`/api/store` writes. The current build is the right size for an internal team
tool; the upgrade path is open when you need it.
