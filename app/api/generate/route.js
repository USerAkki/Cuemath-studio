// ─────────────────────────────────────────────────────────────────────────────
// app/api/generate/route.js — AI proxy (server-side only)
//
// Uses Groq (primary) or Gemini (fallback) — see lib/ai.js
// Both have automatic retry with exponential backoff on rate limits.
//
// Vercel: set GROQ_API_KEY for best performance (30 RPM free tier).
//         set GEMINI_API_KEY as fallback (15 RPM free tier).
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { aiGenerate, extractJSON, AIErrorCode, AIError } from "@/lib/ai";
import { log } from "@/lib/logger";
import {
  carouselPrompt,
  rewritePrompt,
  alternativesPrompt,
  enhancePrompt,
  designerBriefPrompt,
} from "@/lib/prompts";

const IS_DEV = process.env.NODE_ENV !== "production";

function ok(data, debug = {}) {
  const body = { data };
  if (IS_DEV && Object.keys(debug).length) body._debug = debug;
  return NextResponse.json(body, { status: 200 });
}

function err(message, code = "UNKNOWN", status = 500, debug = {}) {
  const body = { error: message, code };
  if (IS_DEV && Object.keys(debug).length) body._debug = debug;
  return NextResponse.json(body, { status });
}

function requireFields(body, fields) {
  for (const f of fields) {
    if (body[f] === undefined || body[f] === null || body[f] === "")
      return `Missing required field: "${f}"`;
  }
  return null;
}

export async function POST(request) {
  const start = Date.now();
  let body;

  try {
    body = await request.json();
  } catch {
    return err("Request body is not valid JSON", "INVALID_BODY", 400);
  }

  const { type } = body;
  if (!type) return err('Request body must include a "type" field', "MISSING_TYPE", 400);

  log.info("generate", "Request received", { type });

  try {
    switch (type) {

      case "carousel": {
        const missing = requireFields(body, ["brief", "personaId", "tone", "formatKey"]);
        if (missing) return err(missing, "INVALID_BODY", 400);
        const { brief, personaId, tone, formatKey, isAb = false } = body;
        if (typeof tone !== "number" || tone < 0 || tone > 100)
          return err('"tone" must be a number between 0 and 100', "INVALID_BODY", 400);
        const prompt = carouselPrompt({ brief, personaId, tone, formatKey, isAb });
        const raw    = await aiGenerate(prompt, { maxTokens: 2200, temperature: 0.88 });
        const result = extractJSON(raw);
        if (!Array.isArray(result.slides) || result.slides.length < 2)
          throw new AIError("AI returned no slides", AIErrorCode.INVALID_JSON);
        log.info("generate", "Carousel generated", { slides: result.slides.length, ms: Date.now()-start });
        return ok(result, { ms: Date.now()-start });
      }

      case "rewrite": {
        const missing = requireFields(body, ["slideType", "headline", "body", "brief"]);
        if (missing) return err(missing, "INVALID_BODY", 400);
        const raw    = await aiGenerate(rewritePrompt(body), { maxTokens: 320, temperature: 0.9 });
        const result = extractJSON(raw);
        if (!result.headline) throw new AIError("Rewrite returned no headline", AIErrorCode.INVALID_JSON);
        return ok(result);
      }

      case "alternatives": {
        const missing = requireFields(body, ["slideType", "headline", "brief"]);
        if (missing) return err(missing, "INVALID_BODY", 400);
        const raw    = await aiGenerate(alternativesPrompt({ ...body, body: body.body || "" }), { maxTokens: 240, temperature: 0.95 });
        const result = extractJSON(raw);
        if (!Array.isArray(result.alternatives) || !result.alternatives.length)
          throw new AIError("No alternatives in response", AIErrorCode.INVALID_JSON);
        return ok(result);
      }

      case "enhance": {
        const missing = requireFields(body, ["brief"]);
        if (missing) return err(missing, "INVALID_BODY", 400);
        const enhanced = await aiGenerate(enhancePrompt({ brief: body.brief }), { maxTokens: 240, temperature: 0.85 });
        if (!enhanced?.trim()) throw new AIError("Empty enhance response", AIErrorCode.EMPTY);
        return ok({ enhanced: enhanced.trim() });
      }

      case "designer-brief": {
        const missing = requireFields(body, ["slides", "brief", "format"]);
        if (missing) return err(missing, "INVALID_BODY", 400);
        if (!Array.isArray(body.slides) || !body.slides.length)
          return err('"slides" must be a non-empty array', "INVALID_BODY", 400);
        const text = await aiGenerate(designerBriefPrompt({ ...body, score: body.score ?? 0 }), { maxTokens: 420, temperature: 0.8 });
        if (!text?.trim()) throw new AIError("Empty designer brief", AIErrorCode.EMPTY);
        return ok({ brief: text.trim() });
      }

      default:
        return err(`Unknown request type: "${type}"`, "UNKNOWN_TYPE", 400);
    }

  } catch (e) {
    log.error("generate", "Handler threw", e);
    const statusMap = {
      [AIErrorCode.NO_KEY]:       500,
      [AIErrorCode.RATE_LIMIT]:   429,
      [AIErrorCode.INVALID_JSON]: 502,
      [AIErrorCode.EMPTY]:        502,
      [AIErrorCode.UPSTREAM]:     502,
      [AIErrorCode.TIMEOUT]:      504,
    };
    const status  = statusMap[e.code] || 500;
    const userMsg = e.code === AIErrorCode.RATE_LIMIT
      ? "The AI service is busy — please wait a moment and try again."
      : (status >= 500 && !IS_DEV)
      ? "Server error — please try again"
      : e.message;
    return err(userMsg, e.code || "SERVER_ERROR", status, IS_DEV ? { stack: e.stack } : {});
  }
}
