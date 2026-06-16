// /api/scan — server-side relay to the Anthropic API.
// The API key lives ONLY here (in an env var), never in browser code.
// The browser sends { prompt }, we add the key and call Anthropic.

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY. Set it in Vercel project settings." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: "Bad request body" }); }
  }
  const prompt = body && body.prompt;
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Missing prompt" });
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        system:
          "You are a grant research assistant. You have extensive knowledge of funding opportunities. Output only a valid, closed JSON array — no markdown, no prose.",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: (data && data.error && data.error.message) || "Anthropic API error" });
    }
    // Return only the text blocks the frontend needs.
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Relay failed" });
  }
}
