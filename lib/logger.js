// ─────────────────────────────────────────────────────────────────────────────
// lib/logger.js — Structured server-side logger
//
// In development : logs full details to console with colour coding.
// In production  : logs JSON-structured entries (Vercel captures these).
//
// Usage:
//   import { log } from "@/lib/logger";
//   log.info("generate", "Carousel request received", { persona, tone });
//   log.error("generate", "Gemini call failed", error);
// ─────────────────────────────────────────────────────────────────────────────

const IS_DEV = process.env.NODE_ENV !== "production";

function format(level, scope, message, meta = {}) {
  const ts = new Date().toISOString();
  if (IS_DEV) {
    const colours = { INFO: "\x1b[36m", WARN: "\x1b[33m", ERROR: "\x1b[31m" };
    const c = colours[level] || "\x1b[0m";
    const reset = "\x1b[0m";
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : "";
    console.log(`${c}[${level}]${reset} [${scope}] ${message}${metaStr ? "\n" + metaStr : ""}`);
  } else {
    // Production: structured JSON — captured by Vercel / any log aggregator
    console.log(JSON.stringify({ ts, level, scope, message, ...meta }));
  }
}

export const log = {
  info:  (scope, message, meta) => format("INFO",  scope, message, meta),
  warn:  (scope, message, meta) => format("WARN",  scope, message, meta),
  error: (scope, message, error) => format("ERROR", scope, message, {
    error:   error?.message   || String(error),
    code:    error?.code      || undefined,
    status:  error?.status    || undefined,
  }),
};
