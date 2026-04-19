// ─────────────────────────────────────────────────────────────────────────────
// lib/prompts.js — All Gemini prompt builders
//
// All prompt logic lives here. To change what the AI generates,
// edit the relevant function. The API route imports these.
// ─────────────────────────────────────────────────────────────────────────────

export const PERSONAS = {
  aspirational: { label: "Aspirational",      desc: "Outcome-driven. Responds to competitive advantage, measurable results, and peer benchmarks." },
  skeptic:      { label: "Evidence-Led",      desc: "Needs proof before trust. Responds to research citations, exact statistics, and expert credentials." },
  overwhelmed:  { label: "Time-Constrained",  desc: "Overloaded with information. Needs simplicity, brevity, and immediate actionable guidance." },
  progressive:  { label: "Future-Focused",    desc: "Tech-forward. Values AI-era readiness and preparing children for 2030+." },
  traditional:  { label: "Trust-Anchored",    desc: "Cautious of trends. Responds to proven methods, stability, and child wellbeing framing." },
};

export const FORMATS = {
  instagram: { label: "Instagram Post",   sub: "1:1",      hint: "Dense insight in 2 lines. Lead with parent fear or aspiration." },
  story:     { label: "Instagram Story",  sub: "9:16",     hint: "Every word earns the next tap. Bold single-idea slides." },
  linkedin:  { label: "LinkedIn Article", sub: "1.91:1",   hint: "Research-first framing. Position Cuemath as thought leader." },
};

function toneDescription(tone) {
  if (tone <= 20) return "pure empathetic storytelling — lead with parental emotion, minimal data";
  if (tone <= 40) return "warm and informative — blend empathy with light evidence";
  if (tone <= 60) return "balanced authority — equal emotional and research weight";
  if (tone <= 80) return "data-led insights — lean into research and statistics";
  return "research authority — scientific precision, expert positioning, exact stats";
}

// ── Carousel generation ───────────────────────────────────────────────────────
export function carouselPrompt({ brief, personaId, tone, formatKey, isAb = false }) {
  const persona = PERSONAS[personaId] || PERSONAS.aspirational;
  const fmt     = FORMATS[formatKey]  || FORMATS.instagram;
  const abNote  = isAb
    ? "\n\nCRITICAL: Generate a completely different angle, hook style, and emotional entry point. Treat this as an entirely fresh creative direction."
    : "";

  return `You are a world-class social media strategist for Cuemath, a premium K-12 math education platform.

TARGET: Parents aged 28-45
PERSONA: ${persona.label} — ${persona.desc}
FORMAT: ${fmt.label} (${fmt.sub}) — ${fmt.hint}
TONE (${tone}/100): ${toneDescription(tone)}
BRIEF: ${brief}${abNote}

Return ONLY a raw JSON object. No markdown fences, no explanation:

{
  "title": "4-6 word carousel title",
  "slides": [
    {
      "id": 1,
      "type": "hook",
      "headline": "5-7 words MAX — scroll-stopping, pattern-interrupt",
      "subheadline": "8-12 word supporting line, or null",
      "body": "Core insight in plain conversational language, 25-35 words exactly",
      "stat": "Striking stat or pull-quote max 12 words, or null",
      "emoji": "single most relevant emoji",
      "visual_keyword": "one concrete noun for art direction e.g. brain graph clock wave"
    }
  ],
  "caption": "2-3 warm non-preachy Instagram sentences for parents",
  "hashtags": ["Cuemath","MathLearning","KidsMath","StudySmart","MathTips","ParentingWins"],
  "engagement_score": 7.8,
  "engagement_breakdown": {
    "hook_strength": 8,
    "content_depth": 7,
    "visual_flow": 8,
    "cta_clarity": 7,
    "brand_voice": 8,
    "emotional_resonance": 7
  },
  "engagement_tip": "Single most impactful improvement — one sharp specific sentence",
  "narrative_arc": [
    { "slide": 1, "label": "Disruption", "emotion": "surprise", "intensity": 9 }
  ],
  "psychological_profile": {
    "curiosity_gap": 8,
    "social_proof": 6,
    "authority_signal": 7,
    "aspiration_pull": 9,
    "pain_acknowledgment": 7
  },
  "retention_curve": [95, 78, 65, 60, 68, 55],
  "content_longevity": "evergreen",
  "longevity_reason": "One sentence explaining shelf life",
  "brand_voice_notes": "One sentence brand voice assessment",
  "competitive_angle": "What specifically distinguishes this from generic education content"
}

Non-negotiable rules:
— Generate exactly 5-6 slides. Sequence: hook | insight | stat | tip | cta
— Slide 1: must challenge a belief, use a surprising stat, or pose an unanswerable question
— Last slide: must name Cuemath and give one specific call to action
— All headlines: 7 words maximum, no exceptions
— narrative_arc: array matching slide count, each with: slide (int), label (string), emotion (lowercase string), intensity (int 1-10)
— retention_curve: array of integers matching slide count, first value always 90-100
— content_longevity: exactly one of — evergreen | seasonal | trending
— psychological_profile: all integers 1-10
— Voice: warm science-backed confident — never salesy never preachy`;
}

// ── Single slide rewrite ──────────────────────────────────────────────────────
export function rewritePrompt({ slideType, headline, body, brief }) {
  return `Return ONLY a raw JSON object — no markdown, no fences. Fields: headline, subheadline, body, stat, emoji, visual_keyword.

Rewrite this ${slideType} carousel slide to be significantly stronger. Headline must be 7 words or fewer.

Current headline: "${headline}"
Current body: "${body}"
Topic context: ${brief}

Requirements: stronger hook, clearer insight, more scroll-stopping than the original.`;
}

// ── Headline alternatives ─────────────────────────────────────────────────────
export function alternativesPrompt({ slideType, headline, body, brief }) {
  return `Return ONLY raw JSON: { "alternatives": ["headline1", "headline2", "headline3"] }. No markdown, no fences.

Generate 3 alternative headlines for this ${slideType} slide. Each must be 7 words or fewer.
Use three different psychological angles:
  1. Curiosity gap — create an information gap the reader must close
  2. Bold declaration — a confident, slightly provocative statement
  3. Provocative question — question that challenges a belief

Current headline: "${headline}"
Body context: ${body}
Topic: ${brief}`;
}

// ── Brief enhancer ────────────────────────────────────────────────────────────
export function enhancePrompt({ brief }) {
  return `You are a senior social media strategist for Cuemath. Expand this rough content idea into a precise, strategy-aligned carousel brief in 2-3 focused sentences. Keep it specific and actionable. Return only the enhanced brief text — no labels, no preamble, no quotes.

Rough idea: "${brief}"`;
}

// ── Designer handoff brief ────────────────────────────────────────────────────
export function designerBriefPrompt({ slides, brief, format, score }) {
  return `You are a creative director writing a concise one-paragraph design brief for a graphic designer. Plain prose only — no bullets, no markdown.

Topic: "${brief}"
Format: ${format}
Slides: ${slides.map((s, i) => `${i + 1}. "${s.headline}" [${s.type}]`).join(", ")}
Brand: Cuemath — primary orange #FF5500, accent green #00CC85, dark background #03040A
Engagement score: ${score}/10

Cover: visual direction, typography mood, colour emphasis, layout intent per slide, and key emotional goal.`;
}
