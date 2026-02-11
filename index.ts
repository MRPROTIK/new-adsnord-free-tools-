type Level = "High" | "Medium" | "Low";
type Intent = "Informational" | "Commercial" | "Transactional";
type Funnel = "TOFU" | "MOFU" | "BOFU";
type KWType = "short_tail" | "long_tail";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
    },
  });
}

function clean(s: string, max = 120) {
  return (s || "")
    .toString()
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

function titleCase(s: string) {
  return s
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function intentFromKeyword(k: string): Intent {
  const kw = k.toLowerCase();
  if (/(buy|price|cost|hire|book|quote|deal|near me|service|agency|order)/.test(kw)) {
    return "Transactional";
  }
  if (/(best|top|compare|review|vs|pricing)/.test(kw)) return "Commercial";
  if (/(how to|what is|guide|tutorial|ideas)/.test(kw)) return "Informational";
  return "Commercial";
}

function funnelFromIntent(intent: Intent): Funnel {
  if (intent === "Informational") return "TOFU";
  if (intent === "Commercial") return "MOFU";
  return "BOFU";
}

function levelByLength(k: string): { volume: Level; competition: Level } {
  const words = k.trim().split(/\s+/).filter(Boolean).length;
  // Heuristic: shorter keywords generally = higher volume + higher competition
  if (words <= 2) return { volume: "High", competition: "High" };
  if (words === 3) return { volume: "Medium", competition: "High" };
  if (words === 4) return { volume: "Medium", competition: "Medium" };
  return { volume: "Low", competition: "Low" };
}

function reasonFor(k: string, business: string, goal: string, intent: Intent): string {
  const g = goal.toLowerCase();
  const b = business.toLowerCase();

  const goalHint =
    g.includes("call")
      ? "Strong call intent for high-conversion traffic."
      : g.includes("lead")
      ? "Good lead-gen intent with clear service demand."
      : g.includes("sale")
      ? "Purchase-driven phrasing supports sales-focused campaigns."
      : g.includes("awareness")
      ? "Broad discovery intent works well for awareness."
      : g.includes("retarget")
      ? "Good for warm audiences and follow-up messaging."
      : "Balanced goal alignment for testing.";

  const bizHint =
    b.includes("local")
      ? "Add location modifiers (city/area) for better relevance."
      : b.includes("ecom")
      ? "Works best with product/category landing pages."
      : b.includes("saas")
      ? "Pair with feature + benefit ad angles."
      : b.includes("agency")
      ? "Use in service page + proof-driven ads."
      : "Align landing page headline to the keyword.";

  const intentHint =
    intent === "Transactional"
      ? "High buying intent."
      : intent === "Commercial"
      ? "Comparison/decision intent."
      : "Research intent—use as top-funnel content or softer offers.";

  return `${intentHint} ${goalHint} ${bizHint}`;
}

function buildKeywords(keyword: string, business: string, goal: string) {
  const base = clean(keyword, 80);
  const b = clean(business, 40);
  const g = clean(goal, 30);

  // 3 short-tail (compact)
  const short = [
    `${base} ${b}`.trim(),
    `${base} ${g}`.trim(),
    `${base} service`.trim(),
  ];

  // 2 long-tail (specific)
  const long = [
    `hire ${base} ${b} for ${g}`.trim(),
    `best ${base} ${b} to get ${g}`.trim(),
  ];

  // De-dup + ensure exactly 5
  const uniq = Array.from(new Set([...short, ...long])).slice(0, 5);
  while (uniq.length < 5) uniq.push(`${base} ${b} ${g}`.trim());

  const results = uniq.map((k, idx) => {
    const type: KWType = idx < 3 ? "short_tail" : "long_tail";
    const intent = intentFromKeyword(k);
    const funnel = funnelFromIntent(intent);
    const levels = levelByLength(k);

    return {
      keyword: titleCase(k),
      type,
      intent_type: intent,
      funnel_stage: funnel,
      volume_level: levels.volume,
      competition_level: levels.competition,
      reason: reasonFor(k, business, goal, intent),
    };
  });

  const best_pick =
    results.find((r) => r.funnel_stage === "BOFU")?.keyword || results[0].keyword;

  const copy_block =
    `Short-tail:\n` +
    results
      .filter((r) => r.type === "short_tail")
      .map((r, i) => `${i + 1}) ${r.keyword}`)
      .join("\n") +
    `\n\nLong-tail:\n` +
    results
      .filter((r) => r.type === "long_tail")
      .map((r, i) => `${i + 1}) ${r.keyword}`)
      .join("\n");

  return { results, best_pick, copy_block };
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // ✅ CORS preflight
    if (request.method === "OPTIONS") {
      return json({ ok: true }, 200);
    }

    // ✅ Tool endpoint
    if (url.pathname.includes("/keyword-analyzer")) {
      const keyword = clean(url.searchParams.get("keyword") || "");
      const goal = clean(url.searchParams.get("goal") || "");
      const business = clean(url.searchParams.get("business") || "");

      if (!keyword || !goal || !business) {
        return json(
          { status: "error", message: "Missing required inputs: keyword, business, goal" },
          400
        );
      }

      const { results, best_pick, copy_block } = buildKeywords(keyword, business, goal);

      // ✅ UI-compatible response
      return json({
        status: "success",
        version: "v2",
        best_pick,
        copy_block,
        results,
      });
    }

    // default root response
    return new Response("AdsNord Hub is Ready. Use /keyword-analyzer", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};
