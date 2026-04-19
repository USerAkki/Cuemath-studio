# Cuemath Social Studio

AI-powered social media carousel creator for Cuemath content teams.
Built for **Problem 2 — The Social Media Studio**.

---

## ⚡ Quick Setup (2 minutes)

### Step 1 — Get a FREE Groq API Key (Recommended)

Groq is the best provider for this app: **30 RPM free**, ultra-fast, no credit card needed.

1. Go to **https://console.groq.com**
2. Sign up (free) → click **API Keys** → **Create API Key**
3. Copy the key (starts with `gsk_...`)

> **Alternative:** Use Gemini — get a key at https://aistudio.google.com/apikey  
> Gemini free tier = 15 RPM (half of Groq). The app auto-retries on rate limits so it still works.

---

### Step 2 — Add keys to Vercel

In **Vercel Dashboard → Project → Settings → Environment Variables**:

| Variable | Value | Notes |
|----------|-------|-------|
| `GROQ_API_KEY` | `gsk_...` | From console.groq.com — **recommended** |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Best free model |
| `GEMINI_API_KEY` | `AIzaSy...` | Optional fallback |
| `GEMINI_MODEL` | `gemini-1.5-flash` | Better free limits than 2.0-flash |

You only need **one** key. If both are set, Groq is primary with Gemini as automatic fallback.

---

### Step 3 — Deploy

```bash
git push  # Vercel auto-deploys on push
```

Or drag the folder into **vercel.com/new** for instant deploy.

---

## Run locally

```bash
# 1. Install
npm install

# 2. Create .env.local and add your key
cp .env.example .env.local
# Edit .env.local — add GROQ_API_KEY or GEMINI_API_KEY

# 3. Test your key
node scripts/test-key.mjs

# 4. Start
npm run dev
# Open http://localhost:3000

# 5. Verify
# Open http://localhost:3000/api/health
```

---

## How rate limiting is handled

This version includes **automatic retry with exponential backoff**:

- On any 429 rate limit response, the server **automatically waits and retries** up to 3 times
- Retry delays: 3s → 7s → 15s
- If both Groq and Gemini keys are set, a Groq failure automatically falls back to Gemini
- The user never sees a rate limit error unless all retries fail

The Vercel function timeout is set to **60 seconds** to allow retries to complete.

---


AI-powered social media carousel creator for Cuemath content teams.
Built for **Problem 2 — The Social Media Studio**.

---

## Run locally — exact steps

```bash
# Step 1 — unzip and enter folder
unzip cuemath-studio-final.zip
cd cuemath-studio

# Step 2 — install dependencies (~30 seconds)
npm install

# Step 3 — test your API key (do this before anything else)
node scripts/test-key.mjs

# Step 4 — start
npm run dev
# Open http://localhost:3000

# Step 5 — verify everything is wired
# Open http://localhost:3000/api/health in your browser
```

The key test script will tell you:
- `PASS / Everything is working` — run npm run dev, you are done
- `INFO / Network proxy blocked` — this means you are running it in a restricted
  environment (like a CI sandbox). The key format is valid. Run it on your own
  machine and it will work.
- `FAIL / Key invalid (401)` — get a new key at https://aistudio.google.com/apikey
  and paste it into `.env.local`
- `FAIL / Model not found (400)` — change `GEMINI_MODEL=gemini-1.5-flash` in `.env.local`

---

## If the key does not work

Open `.env.local` and update:

```
GEMINI_API_KEY=your_new_key_here
GEMINI_MODEL=gemini-1.5-flash   ← use this if gemini-2.0-flash gives errors
```

Get a free key at: **https://aistudio.google.com/apikey**

---

## Deploy to Vercel (5 minutes)

```bash
npm i -g vercel
vercel
```

When prompted for environment variables, add:
```
GEMINI_API_KEY = AIzaSyCaU2tfpDxFrahH8T5mpJaUXpeyuF9lCt4
```

Your submission URL will be something like `https://cuemath-studio-xyz.vercel.app`

---

## Project structure

```
cuemath-studio/
├── package.json                     deps + scripts
├── jsconfig.json                    @/ path alias
├── next.config.mjs                  Next.js config + security headers
├── .env.local                       API key (gitignored — never committed)
├── .env.example                     safe template to commit
├── .gitignore
│
├── app/
│   ├── page.jsx                     entry → ErrorBoundary wraps Studio
│   ├── layout.jsx
│   ├── globals.css
│   └── api/
│       ├── generate/route.js        ALL 5 AI call types (server-side, key safe)
│       └── health/route.js          GET /api/health — diagnostics
│
├── components/
│   ├── Studio.jsx                   full application UI + logic
│   └── ErrorBoundary.jsx            catches render errors, shows recovery UI
│
├── lib/
│   ├── gemini.js                    Gemini HTTP client (server-only)
│   ├── prompts.js                   all 5 prompt builders in one place
│   └── logger.js                    structured logs (dev coloured / prod JSON)
│
└── scripts/
    ├── check-env.js                 npm run check:env
    └── test-key.mjs                 npm run test:key (real Gemini ping)
```

---

## Available scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start development server on port 3000 |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `node scripts/test-key.mjs` | Test Gemini key with a real API call |
| `npm run check:env` | Verify .env.local is present and key is set |

---

## Architecture — security

The Gemini API key lives in `process.env.GEMINI_API_KEY` on the server only.
`lib/gemini.js` (server-only) reads it. `app/api/generate/route.js` calls it.
The browser sends requests to `/api/generate` — never to Google directly.
The key is never in any client-side bundle.

```
Browser (Studio.jsx)
    │  POST /api/generate
    │  { type, brief, personaId, tone, formatKey }
    ▼
Server (route.js)
    │  process.env.GEMINI_API_KEY  ← server-only
    ▼
Gemini API → response → browser
```

---

## System design principles in the code

All 8 are annotated in `components/Studio.jsx` with comments:

| # | Principle | Where |
|---|---|---|
| 1 | Request Deduplication | `generate()` — exits early if already running |
| 2 | In-Memory Cache | `cache.current` Map — same inputs = instant replay |
| 3 | Circuit Breaker | 3 errors → 12s cooldown with live countdown |
| 4 | Optimistic UI | Shimmer skeleton appears the instant Generate is clicked |
| 5 | Stale Request Guard | `AbortController` cancels in-flight when new request starts |
| 6 | Debounced Side-Effects | Brief analyzer fires 400ms after typing stops (no API cost) |
| 7 | Lazy State Hydration | `localStorage` loads once on mount |
| 8 | Idempotent Slide Edits | Field updates are pure `.map()` — no mutation |

---

## What was built vs what was asked

| Problem 2 requirement | Implementation |
|---|---|
| From idea to visual | Brief → structured slides with per-slide SVG art |
| Instagram Post 1:1 | 460×460, hook-first content strategy |
| Instagram Story 9:16 | 260×462, tap-momentum content strategy |
| LinkedIn 1.91:1 | 460×241, research-authority content strategy |
| Image generation | Procedural SVG art per slide type — no external API, no rate limits |
| Carousel storytelling | Hook → Insight → Stat → Tip → CTA enforced by prompt |
| Editability | Inline editor, per-slide rewrite, headline alternatives, A/B variant |
| Brand consistency | 5 personas × tone slider × colour theme baked into every prompt |

### Beyond the brief

- Engagement scoring (6 dimensions with animated bars)
- Psychological trigger analysis (5 dimensions)
- Swipe retention curve prediction per slide
- Narrative arc chart with hover-to-reveal emotion mapping
- Content longevity classification (evergreen / seasonal / trending)
- AI brief enhancer (transforms rough input into strategic brief)
- Scroll-stop probability scored locally per headline
- 21-day content calendar with localStorage persistence
- Figma design token export
- Designer handoff brief generation
- Session history persisted across browser sessions
- Keyboard shortcuts: ← → navigate, E edit, Escape exit

---

## Editing guide

| What to change | Where |
|---|---|
| API key | `.env.local` → `GEMINI_API_KEY` |
| Model | `.env.local` → `GEMINI_MODEL=gemini-1.5-flash` |
| Add a persona | `lib/prompts.js` → `PERSONAS` object |
| Add a format | `lib/prompts.js` → `FORMATS`, `components/Studio.jsx` → `FORMATS` |
| Change colours | `components/Studio.jsx` → Section A → `C` object |
| Change prompt | `lib/prompts.js` → `carouselPrompt()` |
| Add API call type | `app/api/generate/route.js` → add `case "your-type":` |
| Change circuit breaker | `components/Studio.jsx` → `CB_MAX_ERRORS` / `CB_COOLDOWN_MS` |
| Change slide art | `components/Studio.jsx` → Section D → `arts` object |
