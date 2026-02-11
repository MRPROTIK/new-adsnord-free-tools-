export interface Env {
  OPENAI_API_KEY: string;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
      "cache-control": "no-store"
    }
  });
}

function clean(s: string, max = 120) {
  return (s || "")
    .toString()
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

async function callOpenAI(env: Env, keyword: string, business: string, goal: string) {
  const prompt = `
You are an expert Google Ads strategist.

Input:
- Mother keyword: "${keyword}"
- Business type: "${business}"
- Goal: "${goal}"

Return STRICT JSON only in this exact schema:

{
  "best_pick": "<one of the 5 keywords>",
  "copy_block": "Short-tail:\\n1) ...\\n2) ...\\n3) ...\\n\\nLong-tail:\\n1) ...\\n2) ...",
  "results": [
    {
      "keyword": "",
      "type": "short_tail",
      "intent_type": "Informational|Commercial|Transactional",
      "funnel_stage": "TOFU|MOFU|BOFU",
      "volume_level": "High|Medium|Low",
      "competition_level": "High|Medium|Low",
      "reason": ""
    }
  ]
}

Rules:
- results MUST contain exactly 5 items: 3 short_tail + 2 long_tail
- No extra keys, no markdown, JSON only
- Make keywords realistic and ad-ready
`.trim();

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: "You output only valid JSON. No markdown." },
        { role: "user", content: prompt }
      ]
    })
  });

  if (!r.ok) {
    const t = await r.text();
    throw new Error(`OpenAI error: ${r.status} ${t}`);
  }

  const data = await r.json() as any;
  const content = data?.choices?.[0]?.message?.content || "{}";

  try {
    return JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("Failed to parse JSON from model output.");
    return JSON.parse(m[0]);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return json({ ok: true });

    const url = new URL(req.url);

    // ✅ accept both business and business_type just in case
    const keyword = clean(url.searchParams.get("keyword") || "");
    const business = clean(url.searchParams.get("business") || url.searchParams.get("business_type") || "");
    const goal = clean(url.searchParams.get("goal") || "");

    if (!keyword || !business || !goal) {
      return json({ status: "error", message: "Missing required inputs: keyword, business, goal" }, 400);
    }

    try {
      const ai = await callOpenAI(env, keyword, business, goal);

      // Basic safety cleanup
      const results = Array.isArray(ai.results) ? ai.results : [];
      const cleaned = results.slice(0, 5).map((r: any) => ({
        keyword: clean(r.keyword || "", 160),
        type: (r.type === "long_tail" ? "long_tail" : "short_tail"),
        intent_type: r.intent_type || "Commercial",
        funnel_stage: r.funnel_stage || "MOFU",
        volume_level: r.volume_level || "Medium",
        competition_level: r.competition_level || "Medium",
        reason: clean(r.reason || "Use in a tightly themed ad group and align landing page copy.", 220)
      }));

      const best_pick = clean(ai.best_pick || cleaned?.[0]?.keyword || "", 160);

      const copy_block =
        ai.copy_block ||
        ("Short-tail:\n" +
          cleaned.filter((x: any) => x.type === "short_tail").map((x: any, i: number) => `${i + 1}) ${x.keyword}`).join("\n") +
          "\n\nLong-tail:\n" +
          cleaned.filter((x: any) => x.type === "long_tail").map((x: any, i: number) => `${i + 1}) ${x.keyword}`).join("\n"));

      return json({
        status: "success",
        best_pick,
        copy_block,
        results: cleaned
      });
    } catch (e: any) {
      return json({ status: "error", message: e?.message || "Unknown error" }, 500);
    }
  }
};
