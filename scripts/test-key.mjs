#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/test-key.mjs — AI Provider Key Tester
// Run: node scripts/test-key.mjs
// Tests whichever key(s) are configured in .env.local
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from "fs";
import { join, dirname }            from "path";
import { fileURLToPath }            from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = join(__dir, "..");

function loadEnv() {
  const p = join(root, ".env.local");
  if (!existsSync(p)) {
    console.error("\n  ERROR  .env.local not found");
    console.error("         Copy .env.example to .env.local\n");
    process.exit(1);
  }
  readFileSync(p, "utf-8").split("\n").forEach(line => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const idx = t.indexOf("=");
    if (idx === -1) return;
    process.env[t.slice(0, idx).trim()] = t.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
  });
}

async function testGroq(apiKey) {
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  console.log(`\n  Testing Groq key with model: ${model}`);

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages:    [{ role: "user", content: 'Reply with only: {"ok":true}' }],
      max_tokens:  20,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (res.status === 200) {
    const data = await res.json();
    const txt  = data?.choices?.[0]?.message?.content?.trim() || "";
    console.log(`  ✓  Groq responded: ${txt}`);
    console.log(`  ✓  Model: ${data?.model || model}`);
    console.log(`  ✓  Rate limit: 30 RPM on free tier`);
    return true;
  } else if (res.status === 429) {
    console.log("  WARN  Rate limited (429) — key is valid, wait 30s");
    return true;
  } else if (res.status === 401) {
    const body = await res.json().catch(() => ({}));
    console.error(`  FAIL  Groq key invalid (401): ${body?.error?.message || ""}`);
    console.error("        Get a new key at https://console.groq.com");
    return false;
  } else {
    const body = await res.text().catch(() => "");
    console.error(`  FAIL  Groq returned HTTP ${res.status}: ${body.slice(0, 100)}`);
    return false;
  }
}

async function testGemini(apiKey) {
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  console.log(`\n  Testing Gemini key with model: ${model}`);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents:         [{ role: "user", parts: [{ text: 'Reply: {"ok":true}' }] }],
      generationConfig: { maxOutputTokens: 20, temperature: 0 },
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (res.status === 200) {
    const data = await res.json();
    const txt  = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    console.log(`  ✓  Gemini responded: ${txt}`);
    console.log(`  ✓  Model: ${model}`);
    console.log(`  ✓  Rate limit: 15 RPM on free tier`);
    return true;
  } else if (res.status === 429) {
    console.log("  WARN  Rate limited (429) — key is valid, wait 30s");
    return true;
  } else if (res.status === 401) {
    console.error("  FAIL  Gemini key invalid (401)");
    console.error("        Get a new key at https://aistudio.google.com/apikey");
    return false;
  } else if (res.status === 400) {
    const body = await res.json().catch(() => ({}));
    console.error(`  FAIL  Gemini bad request (400): ${body?.error?.message || ""}`);
    console.error(`        Model "${model}" may not be available. Try GEMINI_MODEL=gemini-1.5-flash`);
    return false;
  } else {
    const body = await res.text().catch(() => "");
    console.error(`  FAIL  Gemini returned HTTP ${res.status}: ${body.slice(0, 100)}`);
    return false;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
loadEnv();

console.log("\n═══════════════════════════════════════════");
console.log("  Cuemath Studio — API Key Test");
console.log("═══════════════════════════════════════════");

const groqKey   = process.env.GROQ_API_KEY;
const geminiKey = process.env.GEMINI_API_KEY;
let passed = 0;

if (!groqKey && !geminiKey) {
  console.error("\n  FAIL  No API keys found in .env.local");
  console.error("  Set GROQ_API_KEY (recommended) or GEMINI_API_KEY\n");
  process.exit(1);
}

if (groqKey) {
  try {
    const ok = await testGroq(groqKey);
    if (ok) passed++;
  } catch (e) {
    console.error(`  FAIL  Groq test threw: ${e.message}`);
  }
}

if (geminiKey) {
  try {
    const ok = await testGemini(geminiKey);
    if (ok) passed++;
  } catch (e) {
    console.error(`  FAIL  Gemini test threw: ${e.message}`);
  }
}

if (passed > 0) {
  console.log("\n  ═══════════════════════════════════════════");
  console.log("  ✓  At least one provider is working.");
  console.log("  ✓  Auto-retry enabled: 3× with 3s/7s/15s backoff.");
  console.log("  Run: npm run dev\n");
  process.exit(0);
} else {
  console.error("\n  FAIL  No provider passed the live test.");
  console.error("  Check your keys and try again.\n");
  process.exit(1);
}
