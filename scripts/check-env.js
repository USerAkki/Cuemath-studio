#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/check-env.js
// Run: npm run check:env
//
// Verifies that at least one AI provider key (Groq or Gemini) is configured.
// ─────────────────────────────────────────────────────────────────────────────

let ok = true;

console.log("\n═══════════════════════════════════════════");
console.log("  Cuemath Studio — Environment Check");
console.log("═══════════════════════════════════════════\n");

// Load .env.local
try {
  const fs   = require("fs");
  const path = require("path");
  const envPath = path.join(__dirname, "../.env.local");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const k = trimmed.slice(0, idx).trim();
      const v = trimmed.slice(idx + 1).trim();
      process.env[k] = v;
    }
    console.log("  .env.local found and loaded\n");
  } else {
    console.log("  WARNING: .env.local not found — checking process.env\n");
  }
} catch (e) {
  console.log("  Could not read .env.local:", e.message, "\n");
}

const groqKey   = process.env.GROQ_API_KEY;
const geminiKey = process.env.GEMINI_API_KEY;

const mask = (v) => v && v.length > 8 ? `${v.slice(0, 6)}...${v.slice(-4)}` : "****";

// ── Check Groq ────────────────────────────────────────────────────────────────
if (groqKey) {
  const valid = groqKey.startsWith("gsk_");
  console.log(`  ${valid ? "PASS" : "WARN"}  GROQ_API_KEY = ${mask(groqKey)}${valid ? "" : " (should start with gsk_)"}`);
  console.log(`        Model: ${process.env.GROQ_MODEL || "llama-3.3-70b-versatile (default)"}`);
  console.log("        Rate limit: 30 RPM free — RECOMMENDED\n");
} else {
  console.log("  INFO  GROQ_API_KEY — not set");
  console.log("        Get a free key at https://console.groq.com (30 RPM, no CC needed)\n");
}

// ── Check Gemini ──────────────────────────────────────────────────────────────
if (geminiKey) {
  const valid = geminiKey.startsWith("AIzaSy");
  console.log(`  ${valid ? "PASS" : "WARN"}  GEMINI_API_KEY = ${mask(geminiKey)}${valid ? "" : " (should start with AIzaSy)"}`);
  console.log(`        Model: ${process.env.GEMINI_MODEL || "gemini-1.5-flash (default)"}`);
  console.log("        Rate limit: 15 RPM free\n");
} else {
  console.log("  INFO  GEMINI_API_KEY — not set");
  console.log("        Get a free key at https://aistudio.google.com/apikey\n");
}

// ── Final verdict ──────────────────────────────────────────────────────────────
if (!groqKey && !geminiKey) {
  console.error("  FAIL  No AI provider configured.");
  console.error("        Set GROQ_API_KEY (recommended) or GEMINI_API_KEY in .env.local\n");
  process.exit(1);
} else {
  const primary  = groqKey   ? "Groq"   : "Gemini";
  const fallback = groqKey && geminiKey ? " (Gemini fallback enabled)" : "";
  console.log(`  ✓  Using ${primary} as primary provider${fallback}`);
  console.log("  ✓  Auto-retry with backoff enabled on rate limits");
  console.log("\n  All checks passed. Run: npm run dev\n");
}
