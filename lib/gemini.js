// ─────────────────────────────────────────────────────────────────────────────
// lib/gemini.js — Server-side Gemini API client
//
// SECURITY: This file only runs on the server (imported by API routes).
// GEMINI_API_KEY is read from process.env — it is never sent to the browser.
//
// To swap models or tweak generation parameters, edit this file only.
// ─────────────────────────────────────────────────────────────────────────────

import { log } from "@/lib/logger";

const MODEL  = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const BASE   = "https://generativelanguage.googleapis.com/v1beta/models";

// Error codes returned to the client — never expose raw Gemini errors
export const GeminiErrorCode = {
  NO_KEY:       "GEMINI_NO_KEY",
  RATE_LIMIT:   "GEMINI_RATE_LIMIT",
  INVALID_JSON: "GEMINI_INVALID_JSON",
  EMPTY:        "GEMINI_EMPTY_RESPONSE",
  UPSTREAM:     "GEMINI_UPSTREAM_ERROR",
  TIMEOUT:      "GEMINI_TIMEOUT",
};

class GeminiError extends Error {
  constructor(message, code, status = 500) {
    super(message);
    this.name  = "GeminiError";
    this.code  = code;
    this.status = status;
  }
}

// ── Core request function ─────────────────────────────────────────────────────
export async function geminiGenerate(prompt, { maxTokens = 2200, temperature = 0.88, timeoutMs = 30000 } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiError("GEMINI_API_KEY is not set in environment variables", GeminiErrorCode.NO_KEY, 500);

  const url  = `${BASE}/${MODEL}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens: maxTokens },
  };

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === "AbortError") throw new GeminiError("Request timed out after 30s", GeminiErrorCode.TIMEOUT, 504);
    throw new GeminiError(`Network error: ${e.message}`, GeminiErrorCode.UPSTREAM, 502);
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 429) {
    log.warn("gemini", "Rate limited by Gemini API");
    throw new GeminiError("Gemini API rate limit reached — please wait a moment", GeminiErrorCode.RATE_LIMIT, 429);
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const msg     = errBody?.error?.message || `Gemini returned HTTP ${res.status}`;
    log.error("gemini", "Upstream error", { status: res.status, message: msg });
    throw new GeminiError(msg, GeminiErrorCode.UPSTREAM, 502);
  }

  const data  = await res.json();
  const text  = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text?.trim()) throw new GeminiError("Gemini returned an empty response", GeminiErrorCode.EMPTY, 502);

  return text;
}

// ── Safe JSON extraction ──────────────────────────────────────────────────────
// Strips markdown fences and extracts the first JSON object from the response.
export function extractJSON(text) {
  try {
    let s = text.trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();
    const a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a === -1 || b === -1) throw new Error("No JSON object found");
    return JSON.parse(s.slice(a, b + 1));
  } catch (e) {
    throw new GeminiError(`Could not parse JSON from response: ${e.message}`, GeminiErrorCode.INVALID_JSON, 502);
  }
}
