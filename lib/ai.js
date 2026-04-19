// ─────────────────────────────────────────────────────────────────────────────
// lib/ai.js  —  Unified AI client
//
// Priority:  Groq (fast, generous free tier)  →  Gemini (fallback)
//
// Both providers support automatic retry with exponential backoff on 429.
// Set GROQ_API_KEY  in Vercel env vars to use Groq (recommended).
// Set GEMINI_API_KEY to use Gemini (fallback / alternative).
//
// Free tier comparison:
//   Groq   — 30 req/min, no daily hard cap on llama-3.3-70b-versatile
//   Gemini — 15 req/min, 1 500 req/day on gemini-1.5-flash
// ─────────────────────────────────────────────────────────────────────────────

import { log } from "@/lib/logger";

// ── Shared error codes ────────────────────────────────────────────────────────
export const AIErrorCode = {
  NO_KEY:       "AI_NO_KEY",
  RATE_LIMIT:   "AI_RATE_LIMIT",
  INVALID_JSON: "AI_INVALID_JSON",
  EMPTY:        "AI_EMPTY_RESPONSE",
  UPSTREAM:     "AI_UPSTREAM_ERROR",
  TIMEOUT:      "AI_TIMEOUT",
};

export class AIError extends Error {
  constructor(message, code, status = 500) {
    super(message);
    this.name   = "AIError";
    this.code   = code;
    this.status = status;
  }
}

// ── Retry helper ──────────────────────────────────────────────────────────────
// Retries the async fn up to maxRetries times when it throws a rate-limit error.
// Delays (ms): 3 000 → 7 000 → 15 000
async function withRetry(fn, maxRetries = 3) {
  const delays = [3000, 7000, 15000];
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const isRateLimit = e.code === AIErrorCode.RATE_LIMIT || e.status === 429;
      if (isRateLimit && attempt < maxRetries) {
        const delay = delays[attempt] ?? 15000;
        log.warn("ai", `Rate limited — retrying in ${delay / 1000}s (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GROQ provider
// API is OpenAI-compatible. Free tier: 30 RPM.
// Models: llama-3.3-70b-versatile | llama3-8b-8192 | gemma2-9b-it
// ─────────────────────────────────────────────────────────────────────────────
async function groqGenerateOnce(prompt, { maxTokens = 2200, temperature = 0.88, timeoutMs = 45000 } = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new AIError("GROQ_API_KEY is not set", AIErrorCode.NO_KEY, 500);

  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const url   = "https://api.groq.com/openai/v1/chat/completions";

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages:    [{ role: "user", content: prompt }],
        max_tokens:  maxTokens,
        temperature,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") throw new AIError("Request timed out", AIErrorCode.TIMEOUT, 504);
    throw new AIError(`Network error: ${e.message}`, AIErrorCode.UPSTREAM, 502);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429) {
    log.warn("groq", "Rate limited");
    throw new AIError("Groq rate limit reached — retrying shortly", AIErrorCode.RATE_LIMIT, 429);
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const msg     = errBody?.error?.message || `Groq returned HTTP ${res.status}`;
    throw new AIError(msg, AIErrorCode.UPSTREAM, 502);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text?.trim()) throw new AIError("Groq returned an empty response", AIErrorCode.EMPTY, 502);

  log.info("groq", `Generated ${text.length} chars with ${model}`);
  return text;
}

// ─────────────────────────────────────────────────────────────────────────────
// GEMINI provider
// ─────────────────────────────────────────────────────────────────────────────
async function geminiGenerateOnce(prompt, { maxTokens = 2200, temperature = 0.88, timeoutMs = 45000 } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AIError("GEMINI_API_KEY is not set", AIErrorCode.NO_KEY, 500);

  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents:         [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") throw new AIError("Request timed out", AIErrorCode.TIMEOUT, 504);
    throw new AIError(`Network error: ${e.message}`, AIErrorCode.UPSTREAM, 502);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429) {
    log.warn("gemini", "Rate limited");
    throw new AIError("Gemini rate limit reached — retrying shortly", AIErrorCode.RATE_LIMIT, 429);
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const msg     = errBody?.error?.message || `Gemini returned HTTP ${res.status}`;
    throw new AIError(msg, AIErrorCode.UPSTREAM, 502);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text?.trim()) throw new AIError("Gemini returned an empty response", AIErrorCode.EMPTY, 502);

  log.info("gemini", `Generated ${text.length} chars with ${model}`);
  return text;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — aiGenerate(prompt, options)
//
// Uses Groq if GROQ_API_KEY is set (recommended, higher free limits).
// Falls back to Gemini if only GEMINI_API_KEY is set.
// Both have retry with exponential backoff on 429.
// ─────────────────────────────────────────────────────────────────────────────
export async function aiGenerate(prompt, options = {}) {
  const hasGroq   = !!process.env.GROQ_API_KEY;
  const hasGemini = !!process.env.GEMINI_API_KEY;

  if (!hasGroq && !hasGemini) {
    throw new AIError(
      "No AI API key found. Set GROQ_API_KEY (recommended) or GEMINI_API_KEY in your environment.",
      AIErrorCode.NO_KEY,
      500,
    );
  }

  // ── Try Groq first ────────────────────────────────────────────────────────
  if (hasGroq) {
    try {
      return await withRetry(() => groqGenerateOnce(prompt, options));
    } catch (e) {
      if (hasGemini && e.code !== AIErrorCode.NO_KEY) {
        log.warn("ai", `Groq failed (${e.code}) — falling back to Gemini`);
        // fall through to Gemini
      } else {
        throw e;
      }
    }
  }

  // ── Gemini (primary or fallback) ──────────────────────────────────────────
  return await withRetry(() => geminiGenerateOnce(prompt, options));
}

// ── Safe JSON extraction ──────────────────────────────────────────────────────
export function extractJSON(text) {
  try {
    let s = text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a === -1 || b === -1) throw new Error("No JSON object found");
    return JSON.parse(s.slice(a, b + 1));
  } catch (e) {
    throw new AIError(`Could not parse JSON: ${e.message}`, AIErrorCode.INVALID_JSON, 502);
  }
}

// ── Provider info (for health checks) ────────────────────────────────────────
export function getProviderInfo() {
  const hasGroq   = !!process.env.GROQ_API_KEY;
  const hasGemini = !!process.env.GEMINI_API_KEY;
  return {
    primary:  hasGroq   ? "groq"   : hasGemini ? "gemini" : "none",
    fallback: hasGroq && hasGemini ? "gemini"  : "none",
    groqModel:   process.env.GROQ_MODEL   || "llama-3.3-70b-versatile",
    geminiModel: process.env.GEMINI_MODEL || "gemini-1.5-flash",
  };
}
