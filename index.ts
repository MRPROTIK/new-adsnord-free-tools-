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

function clean(s: string, max = 120): string {
  return (s || "")
    .toString()
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

function titleCase(s: string): string {
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
  if (words <= 2) return { volume: "High", competition: "High" };
  if (words === 3) return { volume: "Medium", competition: "High" };
  if (words === 4) return { volume: "Medium", competition: "Medium" };
  return { volume: "Low", competition: "Low" };
}

function buildKeywords(keyword: string, business: string, goal: string) {
  const base = clean(keyword, 80);
  const b = clean(business, 40);
  const g = clean(goal, 30);

  const short = [
    `${base} ${b}`.trim(),
    `${base} ${g}`.trim(),
    `${base} service`.trim(),
  ];

  const long = [
    `hire ${base} ${b} for ${g}`.trim(),
    `best ${base} ${b} to get ${g}`.trim(),
  ];

  const uniq = Array.from(new Set([...short, ...long])).slice(0, 5);

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
      reason: "AI-estimated signal based on structure and keyword intent."
    };
  });

  return results;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return json({ ok: true });
    }

    if (url.pathname.includes("/keyword-analyzer")) {
      const keyword = clean(url.searchParams.get("keyword") || "");
      const goal = clean(url.searchParams.get("goal") || "");
      const business = clean(url.searchParams.get("business") || "");

      if (!keyword || !goal || !business) {
        return json({ status: "error", message: "Missing required inputs" }, 400);
      }

      const results = buildKeywords(keyword, business, goal);

      return json({
        status: "success",
        version: "v2",
        results
      });
    }

    return new Response("AdsNord Hub is Ready. Use /keyword-analyzer");
  },
};
