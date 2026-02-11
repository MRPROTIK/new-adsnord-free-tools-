type Level = "High" | "Medium" | "Low";
type Intent = "Informational" | "Commercial" | "Transactional";
type Funnel = "TOFU" | "MOFU" | "BOFU";
type KWType = "short_tail" | "long_tail";

type Env = {
  AN_KV: KVNamespace;
};

const VERSION = "v2";

/** ✅ CORS allowlist */
const ALLOWED_ORIGINS = new Set([
  "https://adsnord.com",
  "https://www.adsnord.com",
]);

/** ✅ Rate limiting */
const RL_WINDOW_SEC = 600; // 10 minutes
const RL_MAX_REQ = 80;     // per IP per window

/** ✅ Optional cache */
const CACHE_ENABLED = true;
const CACHE_TTL_SEC = 900; // 15 minutes

function getOrigin(req: Request): string {
  return req.headers.get("Origin") || "";
}

/**
 * ✅ FIX 1: Never send Access-Control-Allow-Origin: "" (invalid).
 * ✅ FIX 2: If Origin is missing (""), treat as same-origin/non-browser -> allow.
 */
function corsHeaders(origin: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    // ✅ FIX 3: allow Accept too (preflight-safe)
    "Access-Control-Allow-Headers": "Content-Type,Accept",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };

  // Only set ACAO when we have a valid allowed origin
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function json(req: Request, data: unknown, status = 200): Response {
  const origin = getOrigin(req);
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(origin),
  });
}

/** ✅ Standard error format */
function error(req: Request, status: number, code: string, message: string): Response {
  return json(req, { status: "error", code, message, version: VERSION }, status);
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
  const b = clean(business, 50);
  const g = clean(goal, 40);

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
      reason: "AI-estimated signal based on structure and keyword intent.",
    };
  });

  return results;
}

/** Cloudflare client IP */
function ipFromRequest(req: Request): string {
  return req.headers.get("CF-Connecting-IP") || "0.0.0.0";
}

/** ✅ KV rate limit (fixed window) */
async function rateLimit(env: Env, ip: string): Promise<{ ok: boolean; retryAfterSec?: number }> {
  const now = Date.now();
  const windowId = Math.floor(now / (RL_WINDOW_SEC * 1000));
  const key = `rl:${ip}:${windowId}`;

  const raw = await env.AN_KV.get(key);
  const count = raw ? parseInt(raw, 10) : 0;

  if (count >= RL_MAX_REQ) {
    const nextWindowMs = (windowId + 1) * RL_WINDOW_SEC * 1000;
    const retryAfterSec = Math.max(1, Math.ceil((nextWindowMs - now) / 1000));
    return { ok: false, retryAfterSec };
  }

  const ttl = RL_WINDOW_SEC + 5;
  await env.AN_KV.put(key, String(count + 1), { expirationTtl: ttl });
  return { ok: true };
}

/** ✅ Strict validation */
function validateInputs(keyword: string, business: string, goal: string) {
  if (!keyword || !business || !goal) {
    return { ok: false, code: "MISSING_INPUT", message: "Missing required inputs: keyword, business, goal." };
  }

  if (keyword.length < 2) return { ok: false, code: "BAD_KEYWORD", message: "Keyword is too short." };
  if (keyword.length > 80) return { ok: false, code: "BAD_KEYWORD", message: "Keyword is too long (max 80 chars)." };

  if (business.length < 2 || business.length > 50) {
    return { ok: false, code: "BAD_BUSINESS", message: "Business value is invalid." };
  }
  if (goal.length < 2 || goal.length > 40) {
    return { ok: false, code: "BAD_GOAL", message: "Goal value is invalid." };
  }

  const bad = /(https?:\/\/|<script|<\/script|data:|javascript:)/i;
  if (bad.test(keyword) || bad.test(business) || bad.test(goal)) {
    return { ok: false, code: "BLOCKED_INPUT", message: "Blocked input pattern detected." };
  }

  return { ok: true as const };
}

/** ✅ Cache key */
function cacheKey(keyword: string, business: string, goal: string) {
  const k = clean(keyword, 80).toLowerCase();
  const b = clean(business, 50).toLowerCase();
  const g = clean(goal, 40).toLowerCase();
  return `cache:${VERSION}:${k}::${b}::${g}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = getOrigin(request);

    /** ✅ OPTIONS preflight (Origin must exist for preflight) */
    if (request.method === "OPTIONS") {
      if (!origin || !ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    /** Only allow GET */
    if (request.method !== "GET") {
      return error(request, 405, "METHOD_NOT_ALLOWED", "Only GET is allowed.");
    }

    /**
     * ✅ FIX 4: If Origin is missing ("") do NOT block.
     * Only block when Origin exists AND is not allowed.
     */
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return error(request, 403, "CORS_BLOCKED", "Origin not allowed.");
    }

    /** Route check (safer) */
    if (!url.pathname.startsWith("/keyword-analyzer")) {
      return new Response("AdsNord Hub is Ready. Use /keyword-analyzer", { status: 200 });
    }

    /** Rate limit */
    const ip = ipFromRequest(request);
    const rl = await rateLimit(env, ip);
    if (!rl.ok) {
      const res = error(request, 429, "RATE_LIMITED", "Too many requests. Please try again later.");
      res.headers.set("Retry-After", String(rl.retryAfterSec || 60));
      return res;
    }

    /** Inputs from query string */
    const keyword = clean(url.searchParams.get("keyword") || "", 80);
    const business = clean(url.searchParams.get("business") || "", 50);
    const goal = clean(url.searchParams.get("goal") || "", 40);

    /** Validation */
    const v = validateInputs(keyword, business, goal);
    if (!v.ok) {
      return error(request, 400, v.code || "BAD_REQUEST", v.message || "Invalid inputs.");
    }

    /** Cache */
    const ck = cacheKey(keyword, business, goal);
    if (CACHE_ENABLED) {
      const cached = await env.AN_KV.get(ck);
      if (cached) {
        try {
          return json(request, JSON.parse(cached), 200);
        } catch {
          // cache corrupt -> ignore
        }
      }
    }

    /** Compute */
    const results = buildKeywords(keyword, business, goal);
    const best_pick = results[0]?.keyword || "";
    const copy_block = results.map(r => r.keyword).join("\n");

    const payload = {
      status: "success",
      version: VERSION,
      results,
      best_pick,
      copy_block,
    };

    if (CACHE_ENABLED) {
      await env.AN_KV.put(ck, JSON.stringify(payload), { expirationTtl: CACHE_TTL_SEC });
    }

    return json(request, payload, 200);
  },
};
