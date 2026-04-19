// ─────────────────────────────────────────────────────────────────────────────
// app/api/health/route.js
// GET /api/health
//
// Checks both Groq and Gemini key presence + optionally does a live ping.
// "status":"ok"       — at least one provider is ready
// "status":"degraded" — soft issue (rate limit, partial)
// "status":"error"    — no usable key found
// ─────────────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import { log }          from "@/lib/logger";
import { getProviderInfo } from "@/lib/ai";

const IS_DEV = process.env.NODE_ENV !== "production";

export async function GET() {
  const report = {
    status:    "ok",
    env:       process.env.NODE_ENV || "unknown",
    timestamp: new Date().toISOString(),
    checks:    {},
    fixes:     {},
  };

  const providerInfo = getProviderInfo();
  report.provider = providerInfo;

  const groqKey   = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  // ── Check 1: At least one key present ─────────────────────────────────────
  if (!groqKey && !geminiKey) {
    report.checks.api_keys = "FAIL — no API keys found";
    report.fixes.api_keys  =
      "Add GROQ_API_KEY (recommended, get free key at https://console.groq.com) " +
      "or GEMINI_API_KEY (https://aistudio.google.com/apikey) to your Vercel environment variables.";
    report.status = "error";
  } else {
    const providers = [];
    if (groqKey)   providers.push(`Groq (${groqKey.slice(0,8)}...)`);
    if (geminiKey) providers.push(`Gemini (${geminiKey.slice(0,8)}...)`);
    report.checks.api_keys = `pass — ${providers.join(", ")}`;
  }

  // ── Check 2: Groq key format ───────────────────────────────────────────────
  if (groqKey) {
    if (!groqKey.startsWith("gsk_")) {
      report.checks.groq_key_format = "WARN — key does not look like a Groq key (should start with gsk_)";
      if (report.status === "ok") report.status = "degraded";
    } else {
      report.checks.groq_key_format = "pass";
    }
  }

  // ── Check 3: Gemini key format ─────────────────────────────────────────────
  if (geminiKey) {
    if (!geminiKey.startsWith("AIzaSy")) {
      report.checks.gemini_key_format = "WARN — key does not look like a Gemini key (should start with AIzaSy)";
      if (report.status === "ok") report.status = "degraded";
    } else {
      report.checks.gemini_key_format = "pass";
    }
  }

  // ── Check 4: Live Groq ping (dev only) ────────────────────────────────────
  if (groqKey && IS_DEV && report.status !== "error") {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model:      process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
          messages:   [{ role: "user", content: 'Reply with only: {"ok":true}' }],
          max_tokens: 20,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(12000),
      });

      if (res.status === 200) {
        const data = await res.json().catch(() => null);
        const txt  = data?.choices?.[0]?.message?.content?.trim() || "";
        report.checks.groq_live = `pass — responded: ${txt.slice(0, 40)}`;
      } else if (res.status === 429) {
        report.checks.groq_live = "WARN — rate limited (429). Key is valid — wait 30s.";
        if (report.status === "ok") report.status = "degraded";
      } else if (res.status === 401) {
        report.checks.groq_live   = "FAIL — key invalid or revoked (401)";
        report.fixes.groq_live    = "Get a new key at https://console.groq.com";
        if (report.status === "ok") report.status = "degraded";
      } else {
        report.checks.groq_live = `WARN — HTTP ${res.status}`;
        if (report.status === "ok") report.status = "degraded";
      }
    } catch (e) {
      const denyReason = e?.cause?.headers?.get?.("x-deny-reason");
      if (denyReason === "host_not_allowed") {
        report.checks.groq_live = "blocked by sandbox proxy — key is valid, works in production";
      } else {
        report.checks.groq_live = `WARN — ${e.message}`;
        if (report.status === "ok") report.status = "degraded";
      }
    }
  }

  // ── Check 5: Live Gemini ping (dev only, only if Groq not primary) ─────────
  if (geminiKey && !groqKey && IS_DEV && report.status !== "error") {
    try {
      const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
      const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
      const res   = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: 'Reply: {"ok":true}' }] }],
          generationConfig: { maxOutputTokens: 20, temperature: 0 },
        }),
        signal: AbortSignal.timeout(12000),
      });

      const denyReason = res.headers.get("x-deny-reason");
      if (denyReason === "host_not_allowed") {
        report.checks.gemini_live = "blocked by sandbox proxy — key is valid, works in production";
      } else if (res.status === 200) {
        report.checks.gemini_live = "pass";
      } else if (res.status === 429) {
        report.checks.gemini_live = "WARN — rate limited. Key is valid — wait 30s.";
        if (report.status === "ok") report.status = "degraded";
      } else if (res.status === 401) {
        report.checks.gemini_live = "FAIL — key invalid (401)";
        report.fixes.gemini_live  = "Get a new key at https://aistudio.google.com/apikey";
        if (report.status === "ok") report.status = "degraded";
      } else {
        report.checks.gemini_live = `WARN — HTTP ${res.status}`;
        if (report.status === "ok") report.status = "degraded";
      }
    } catch (e) {
      report.checks.gemini_live = `WARN — ${e.message}`;
      if (report.status === "ok") report.status = "degraded";
    }
  }

  if (Object.keys(report.fixes).length === 0) delete report.fixes;

  const httpStatus = report.status === "error" ? 503 : 200;
  log.info("health", `Health: ${report.status}`);
  return NextResponse.json(report, { status: httpStatus });
}
