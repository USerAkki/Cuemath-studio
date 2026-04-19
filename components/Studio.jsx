"use client";
// ═══════════════════════════════════════════════════════════════════════════════
// components/Studio.jsx — Cuemath Social Media Studio
// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM DESIGN PRINCIPLES (all active):
//
//  1. Request Deduplication    — identical brief+persona+tone returns cached
//                                result instantly without a network call
//  2. In-Memory Cache          — Map<cacheKey, result>, O(1) lookup
//  3. Circuit Breaker          — 3 errors → 12s cooldown, live countdown
//  4. Optimistic UI            — shimmer skeleton appears on click,
//                                zero blank-screen waiting
//  5. Stale Request Guard      — AbortController cancels superseded requests
//  6. Debounced Side-Effects   — brief analysis runs 400ms after typing stops
//  7. Lazy State Hydration     — localStorage loads on mount only
//  8. Idempotent Slide Edits   — field updates are pure array maps, no mutation
//
// API calls: all go through /api/generate (Gemini key stays server-side).
// ═══════════════════════════════════════════════════════════════════════════════

import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// SECTION A — CONSTANTS
// Edit personas, formats, templates, and themes here without touching logic.
// ─────────────────────────────────────────────────────────────────────────────
const CB_MAX_ERRORS     = 3;
const CB_COOLDOWN_MS    = 12000;
const DEBOUNCE_DELAY_MS = 400;

const C = {
  bg: "#03040A", s1: "#07080F", s2: "#0B0C15", s3: "#10111A", s4: "#161720", s5: "#1C1D28",
  border: "#181924", borderHi: "#242538", borderFocus: "#333550",
  orange: "#FF5500", orangeHi: "#FF7033", orangeDim: "rgba(255,85,0,0.08)", orangeGlow: "rgba(255,85,0,0.15)",
  green: "#00CC85", greenDim: "rgba(0,204,133,0.08)", greenGlow: "rgba(0,204,133,0.14)",
  violet: "#8B7FFF", violetDim: "rgba(139,127,255,0.08)",
  gold: "#E8A840", goldDim: "rgba(232,168,64,0.08)",
  rose: "#FF4A6E", roseDim: "rgba(255,74,110,0.08)",
  text: "#EAE5DA", textMid: "#A09B95", muted: "#565870", ghost: "#2A2C3E",
  warn: "#FFB830", danger: "#FF4A4A",
};
const F = {
  display: "'Playfair Display','Georgia',serif",
  ui:      "'Syne',sans-serif",
  body:    "'DM Sans',sans-serif",
  mono:    "'JetBrains Mono','Courier New',monospace",
};

const FORMATS = {
  instagram: { label:"Post",    sub:"1:1",      w:460, h:460, hint:"Dense insight in 2 lines. Lead with parent fear or aspiration." },
  story:     { label:"Story",   sub:"9:16",     w:260, h:462, hint:"Every word earns the next tap. Bold single-idea slides." },
  linkedin:  { label:"LinkedIn",sub:"1.91:1",   w:460, h:241, hint:"Research-first framing. Position Cuemath as thought leader." },
};

const PERSONAS = [
  { id:"aspirational", label:"Aspirational",     col:C.green,  sub:"Outcome-driven",    desc:"Responds to competitive advantage, measurable results, and peer benchmarks." },
  { id:"skeptic",      label:"Evidence-Led",     col:C.violet, sub:"Data-seeking",       desc:"Needs proof before trust. Responds to research citations and exact statistics." },
  { id:"overwhelmed",  label:"Time-Constrained", col:C.warn,   sub:"Clarity-first",      desc:"Overloaded with information. Needs brevity and immediate actionable guidance." },
  { id:"progressive",  label:"Future-Focused",   col:C.orange, sub:"Innovation-minded",  desc:"Tech-forward. Values AI-era readiness and preparing children for 2030+." },
  { id:"traditional",  label:"Trust-Anchored",   col:C.gold,   sub:"Values-led",         desc:"Cautious of trends. Responds to proven methods and child wellbeing framing." },
];

const SLIDE_THEMES = [
  { id:"dark",   label:"Midnight", accent:"#FF5500", accent2:"#00CC85" },
  { id:"navy",   label:"Cobalt",   accent:"#FF5500", accent2:"#4A9FFF" },
  { id:"forest", label:"Verdant",  accent:"#FF7733", accent2:"#00E899" },
];

const TEMPLATES = [
  { label:"The Forgetting Curve",    brief:"Explain why children forget 80% of what they learn within 24 hours — the science of the forgetting curve — and how Cuemath's spaced repetition system reverses it for lasting math mastery." },
  { label:"Early Math Confidence",   brief:"Show parents how early math confidence compounds into lifelong learning ability — with 3 research-backed strategies they can apply at home starting tonight." },
  { label:"Math Anxiety Warning Signs", brief:"Address math anxiety in children — what causes it, how parents can spot the early warning signs, and how to rebuild confidence without adding pressure." },
  { label:"Math in the AI Era",      brief:"Why mathematical reasoning matters more than ever as AI handles computation — which thinking skills define success in 2030 and how parents can build them now." },
  { label:"Growth Mindset Trap",     brief:"Explain why 'I am not a math person' is the most limiting belief a parent can model — and the specific language shift that rewires a child's relationship with learning." },
];

// ─────────────────────────────────────────────────────────────────────────────
// SECTION B — API CLIENT
// All AI calls go through /api/generate. The Gemini key stays on the server.
// ─────────────────────────────────────────────────────────────────────────────
async function apiCall(type, params, signal) {
  const res = await fetch("/api/generate", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ type, ...params }),
    signal,
  });

  const json = await res.json().catch(() => ({ error: `HTTP ${res.status} — invalid JSON response` }));

  if (!res.ok || json.error) {
    const e    = new Error(json.error || `Request failed (HTTP ${res.status})`);
    e.code     = json.code    || "UNKNOWN";
    e.status   = res.status;
    e._debug   = json._debug;
    throw e;
  }

  return json.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION C — LOCAL UTILITY FUNCTIONS (zero API calls)
// ─────────────────────────────────────────────────────────────────────────────
function analyzeBrief(text) {
  if (!text?.trim()) return null;
  const words  = text.trim().split(/\s+/);
  const wc     = words.length;
  const avgLen = words.reduce((s, w) => s + w.replace(/[^a-z]/gi, "").length, 0) / wc;
  const sp     = Math.min(10, Math.round((wc / 5) * 1.2 + (avgLen / 6) * 2 + (/\d/.test(text) ? 1.5 : 0)));
  return {
    words: wc, specificity: sp,
    quality: sp >= 8 ? { label:"Excellent", col:C.green } : sp >= 5 ? { label:"Good", col:C.warn } : { label:"Thin", col:C.danger },
  };
}

function scrollStopScore(slide) {
  if (!slide?.headline) return 0;
  const words     = slide.headline.trim().split(/\s+/);
  const wc        = words.length;
  const hasPower  = words.some(w => ["why","how","stop","never","always","secret","truth","mistake","wrong","your","now","most"].includes(w.toLowerCase()));
  const hasNum    = /\d/.test(slide.headline);
  const typeBonus = { hook:2, stat:1.5, cta:1, insight:1, tip:0.8 };
  let s = 5;
  if (wc >= 5 && wc <= 7) s += 2; else if (wc < 5) s += 1;
  if (hasPower) s += 1.5;
  if (hasNum)   s += 1;
  return Math.min(10, Math.round(s * (typeBonus[slide.type] || 1) * 10) / 10);
}

const toneLabel = v =>
  v <= 20 ? "Empathetic" : v <= 40 ? "Warm + Informed" : v <= 60 ? "Balanced" : v <= 80 ? "Data-Led" : "Scientific";

const shortDate = d =>
  new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" });

// ─────────────────────────────────────────────────────────────────────────────
// SECTION D — SVG ART GENERATOR
// Procedural slide art. No external image API needed.
// Add new art styles by adding a key to the `arts` object.
// ─────────────────────────────────────────────────────────────────────────────
function buildSlideSVG(slide, W, H, theme) {
  const t  = SLIDE_THEMES.find(t => t.id === theme) || SLIDE_THEMES[0];
  const a1 = t.accent, a2 = t.accent2;

  const arts = {
    hook: () => {
      const cx = W*0.78, cy = H*0.3, r = Math.min(W,H)*0.28;
      return `<circle cx="${cx}" cy="${cy}" r="${r*1.4}" fill="${a1}" fill-opacity="0.06"/>
              <circle cx="${cx}" cy="${cy}" r="${r}" fill="${a1}" fill-opacity="0.09"/>
              ${Array.from({length:12},(_,i)=>{const a=(i/12)*Math.PI*2,r1=r*0.7,r2=r*1.1;return`<line x1="${cx+Math.cos(a)*r1}" y1="${cy+Math.sin(a)*r1}" x2="${cx+Math.cos(a)*r2}" y2="${cy+Math.sin(a)*r2}" stroke="${a1}" stroke-width="1" stroke-opacity="0.25"/>`;}).join("")}
              <text x="${cx}" y="${cy+Math.min(W,H)*0.06}" text-anchor="middle" fill="${a1}" font-size="${Math.min(W,H)*0.15}" font-family="Georgia" font-weight="700" fill-opacity="0.11">?</text>
              <path d="M 0 ${H*0.75} Q ${W*0.3} ${H*0.68} ${W*0.65} ${H*0.76}" stroke="${a2}" stroke-width="1" fill="none" stroke-opacity="0.18"/>`;
    },
    insight: () => {
      const nodes = [[0.58,0.22],[0.76,0.17],[0.84,0.32],[0.70,0.42],[0.60,0.34],[0.80,0.46]];
      const edges = [[0,1],[1,2],[2,3],[3,4],[4,0],[2,5],[3,5],[0,5]];
      return `<circle cx="${W*0.7}" cy="${H*0.3}" r="${Math.min(W,H)*0.24}" fill="${a2}" fill-opacity="0.06"/>
              ${edges.map(([a,b])=>`<line x1="${W*nodes[a][0]}" y1="${H*nodes[a][1]}" x2="${W*nodes[b][0]}" y2="${H*nodes[b][1]}" stroke="${a2}" stroke-width="1.2" stroke-opacity="0.22"/>`).join("")}
              ${nodes.map(([x,y],i)=>`<circle cx="${W*x}" cy="${H*y}" r="${3.5+(i%3)*0.8}" fill="${i%2===0?a1:a2}" fill-opacity="${0.5+i*0.06}"/>`).join("")}
              <path d="M ${W*0.08} ${H*0.78} Q ${W*0.4} ${H*0.72} ${W*0.72} ${H*0.8}" stroke="${a1}" stroke-width="1.2" fill="none" stroke-opacity="0.2" stroke-dasharray="5 7"/>`;
    },
    stat: () => {
      const bars=[0.42,0.71,0.52,0.88,0.35,0.63], bw=W*0.06, gap=bw*1.65, bx=W*0.52;
      return `<circle cx="${W*0.72}" cy="${H*0.35}" r="${Math.min(W,H)*0.28}" fill="${a1}" fill-opacity="0.06"/>
              ${bars.map((h,i)=>{const barH=H*0.3*h,x=bx+i*gap-bars.length*gap/2,y=H*0.56-barH;return`<rect x="${x}" y="${y}" width="${bw}" height="${barH}" rx="3" fill="${i===3?a1:a2}" fill-opacity="${0.2+h*0.24}"/>`;}).join("")}
              <line x1="${W*0.3}" y1="${H*0.56}" x2="${W*0.92}" y2="${H*0.56}" stroke="${a2}" stroke-width="1" stroke-opacity="0.22"/>`;
    },
    tip: () => {
      const cx=W*0.8,cy=H*0.28,r=Math.min(W,H)*0.21;
      const hex=Array.from({length:6},(_,i)=>{const a=(i/6)*Math.PI*2-Math.PI/2;return`${cx+r*Math.cos(a)},${cy+r*Math.sin(a)}`;}).join(" ");
      const hex2=Array.from({length:6},(_,i)=>{const a=(i/6)*Math.PI*2-Math.PI/2;return`${cx+r*0.62*Math.cos(a)},${cy+r*0.62*Math.sin(a)}`;}).join(" ");
      return `<polygon points="${hex}" fill="none" stroke="${a2}" stroke-width="1.5" stroke-opacity="0.2"/>
              <polygon points="${hex2}" fill="${a2}" fill-opacity="0.07"/>
              ${Array.from({length:6},(_,i)=>{const a=(i/6)*Math.PI*2-Math.PI/2;return`<circle cx="${cx+r*0.62*Math.cos(a)}" cy="${cy+r*0.62*Math.sin(a)}" r="2.8" fill="${a1}" fill-opacity="0.5"/>`;}).join("")}`;
    },
    cta: () => {
      const cx=W*0.78,cy=H*0.28,r=Math.min(W,H)*0.26;
      return `${Array.from({length:3},(_,i)=>`<circle cx="${cx}" cy="${cy}" r="${r*(0.5+i*0.25)}" fill="none" stroke="${a1}" stroke-width="1" stroke-opacity="${0.12-i*0.03}"/>`).join("")}
              ${Array.from({length:16},(_,i)=>{const angle=(i/16)*Math.PI*2,r1=r*0.3,r2=r*0.5;return`<line x1="${cx+Math.cos(angle)*r1}" y1="${cy+Math.sin(angle)*r1}" x2="${cx+Math.cos(angle)*r2}" y2="${cy+Math.sin(angle)*r2}" stroke="${a1}" stroke-width="1" stroke-opacity="0.2"/>`;}).join("")}
              <circle cx="${cx}" cy="${cy}" r="${r*0.28}" fill="${a1}" fill-opacity="0.18"/>
              <text x="${cx}" y="${cy+Math.min(W,H)*0.05}" text-anchor="middle" fill="${a1}" font-size="${Math.min(W,H)*0.11}" font-family="Georgia" font-weight="700" fill-opacity="0.22">C</text>
              <path d="M ${W*0.08} ${H*0.78} Q ${W*0.45} ${H*0.7} ${W*0.88} ${H*0.78}" stroke="${a1}" stroke-width="1.5" fill="none" stroke-opacity="0.22"/>`;
    },
  };

  const art = (arts[slide?.type] || arts.insight)();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <radialGradient id="vig" cx="50%" cy="50%" r="70%">
        <stop offset="0%" stop-color="#000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000" stop-opacity="0.5"/>
      </radialGradient>
    </defs>
    ${art}
    <rect width="${W}" height="${H}" fill="url(#vig)"/>
  </svg>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION E — SLIDE VISUAL COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
const SlideVisual = memo(function SlideVisual({ slide, format, total, index, theme }) {
  const fmt    = FORMATS[format];
  const narrow = fmt.w < 300;
  const short  = fmt.h < 280;
  const t      = SLIDE_THEMES.find(t => t.id === theme) || SLIDE_THEMES[0];
  const svgUrl = useMemo(() =>
    `data:image/svg+xml,${encodeURIComponent(buildSlideSVG(slide, fmt.w, fmt.h, theme))}`,
    [slide?.type, slide?.visual_keyword, fmt.w, fmt.h, theme]
  );

  const bgMap = {
    hook:    "linear-gradient(148deg,#080B12 0%,#160A00 55%,#07100A 100%)",
    insight: "linear-gradient(148deg,#060C14 0%,#030D08 100%)",
    stat:    "linear-gradient(148deg,#0A0614 0%,#080614 100%)",
    tip:     "linear-gradient(148deg,#060D08 0%,#080D04 100%)",
    cta:     "linear-gradient(148deg,#130900 0%,#1E0900 100%)",
  };

  return (
    <div style={{ width:fmt.w, height:fmt.h, borderRadius:18, position:"relative", overflow:"hidden", flexShrink:0, background:bgMap[slide?.type]||bgMap.insight }}>
      <div style={{ position:"absolute", inset:0, pointerEvents:"none", backgroundImage:`linear-gradient(rgba(255,255,255,0.012) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.012) 1px,transparent 1px)`, backgroundSize:"34px 34px" }}/>
      <img src={svgUrl} alt="" style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover", pointerEvents:"none" }}/>

      {/* Header */}
      <div style={{ position:"absolute", top:0, left:0, right:0, display:"flex", alignItems:"center", justifyContent:"space-between", padding:narrow?"11px 13px":"13px 20px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:7 }}>
          <div style={{ width:narrow?18:22, height:narrow?18:22, borderRadius:5, background:"#FF5500", display:"flex", alignItems:"center", justifyContent:"center", fontSize:narrow?9:11, fontWeight:800, color:"#fff", fontFamily:F.display }}>C</div>
          {!narrow && <span style={{ fontSize:7.5, color:"rgba(255,255,255,0.28)", fontFamily:F.ui, letterSpacing:"0.18em", fontWeight:700 }}>CUEMATH</span>}
        </div>
        <span style={{ fontSize:7.5, color:"rgba(255,255,255,0.2)", fontFamily:F.mono }}>{index+1} / {total}</span>
      </div>

      {/* Content */}
      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", justifyContent:"center", padding:narrow?"44px 14px 30px":short?"38px 22px 24px":"52px 24px 42px", gap:narrow?7:short?5:10 }}>
        {!short && <div style={{ fontSize:narrow?30:42, lineHeight:1 }}>{slide?.emoji}</div>}
        <div style={{ fontSize:narrow?17:short?19:(slide?.headline?.length>26?21:28), fontFamily:F.display, color:"#EDE9DF", lineHeight:1.08, fontWeight:700 }}>{slide?.headline}</div>
        {slide?.subheadline && !short && <div style={{ fontSize:narrow?9:11, color:slide?.type==="cta"?t.accent:t.accent2, fontFamily:F.ui, fontWeight:700, letterSpacing:"0.02em" }}>{slide.subheadline}</div>}
        {slide?.body && <div style={{ fontSize:narrow?9:short?10:12, color:"rgba(237,233,223,0.6)", lineHeight:1.72 }}>{slide.body}</div>}
        {slide?.stat && !short && <div style={{ background:"rgba(255,85,0,0.11)", border:"1px solid rgba(255,85,0,0.26)", borderRadius:8, padding:narrow?"6px 9px":"9px 14px", fontSize:narrow?9:12.5, color:"#FF8A4C", fontFamily:F.ui, fontWeight:700, marginTop:2 }}>{slide.stat}</div>}
        {slide?.type==="cta" && <div style={{ marginTop:8, background:"#FF5500", borderRadius:7, padding:narrow?"6px 12px":"9px 18px", fontSize:narrow?9:12, fontFamily:F.ui, fontWeight:800, color:"#fff", letterSpacing:"0.05em", width:"fit-content" }}>Start Free Trial</div>}
      </div>

      <div style={{ position:"absolute", bottom:0, left:0, right:0, height:3, background:slide?.type==="cta"?"#FF5500":`linear-gradient(90deg,transparent,${t.accent}88,${t.accent2}88,transparent)` }}/>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION F — ANALYTICS COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
const ScoreRing = memo(function ScoreRing({ score }) {
  const r = 36, circ = 2*Math.PI*r;
  const col = score>=8?C.green:score>=6?C.warn:C.danger;
  return (
    <svg width={92} height={92} viewBox="0 0 92 92">
      <circle cx={46} cy={46} r={r} fill="none" stroke={C.s4} strokeWidth={6}/>
      <circle cx={46} cy={46} r={r} fill="none" stroke={col} strokeWidth={6} strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={circ*(1-score/10)}
        transform="rotate(-90 46 46)"
        style={{ transition:"stroke-dashoffset 1.5s cubic-bezier(0.34,1.56,0.64,1)" }}/>
      <text x={46} y={43} textAnchor="middle" fill={col} fontSize={19} fontWeight={700} fontFamily={F.ui}>{score.toFixed(1)}</text>
      <text x={46} y={57} textAnchor="middle" fill={C.muted} fontSize={8.5} fontFamily={F.body}>/10 score</text>
    </svg>
  );
});

function MiniBar({ label, value, col }) {
  return (
    <div style={{ marginBottom:10 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
        <span style={{ fontSize:9.5, color:C.muted, fontFamily:F.ui, fontWeight:700, letterSpacing:"0.04em" }}>{label}</span>
        <span style={{ fontSize:9.5, color:col, fontFamily:F.mono, fontWeight:700 }}>{value}/10</span>
      </div>
      <div style={{ height:3, background:C.s4, borderRadius:2 }}>
        <div style={{ height:"100%", background:col, borderRadius:2, width:`${value*10}%`, transition:"width 1.2s cubic-bezier(0.34,1.56,0.64,1)" }}/>
      </div>
    </div>
  );
}

function NarrativeArcChart({ arc }) {
  const [hov, setHov] = useState(null);
  if (!arc?.length) return null;
  const W=232,H=108,pl=10,pr=10,pt=18,pb=18, iw=W-pl-pr, ih=H-pt-pb, n=arc.length;
  const pts = arc.map((a,i)=>({ x:pl+(n===1?iw/2:(i/(n-1))*iw), y:pt+ih-(Math.max(0,Math.min(10,a.intensity))/10)*ih, ...a }));
  const pathD = pts.reduce((d,p,i)=>{ if(!i) return `M ${p.x} ${p.y}`; const prev=pts[i-1],cx=(prev.x+p.x)/2; return d+` C ${cx} ${prev.y} ${cx} ${p.y} ${p.x} ${p.y}`; },"");
  const last=pts[pts.length-1],first=pts[0];
  const area=`${pathD} L ${last.x} ${pt+ih} L ${first.x} ${pt+ih} Z`;
  const EC={ surprise:C.orange,concern:C.warn,curiosity:C.violet,trust:C.green,hope:C.green,motivation:C.orange,anxiety:C.danger,recognition:C.warn,relief:C.green,excitement:C.orange,anticipation:C.violet };
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display:"block", overflow:"visible" }}>
      <defs>
        <linearGradient id="aL" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor={C.orange}/><stop offset="50%" stopColor={C.violet}/><stop offset="100%" stopColor={C.green}/></linearGradient>
        <linearGradient id="aA" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor={C.violet} stopOpacity="0.14"/><stop offset="100%" stopColor={C.violet} stopOpacity="0"/></linearGradient>
      </defs>
      {[0.25,0.5,0.75].map(f=><line key={f} x1={pl} x2={pl+iw} y1={pt+ih*(1-f)} y2={pt+ih*(1-f)} stroke={C.border} strokeWidth={0.8} strokeDasharray="3 5"/>)}
      <path d={area} fill="url(#aA)"/>
      <path d={pathD} fill="none" stroke="url(#aL)" strokeWidth={2} strokeLinecap="round"/>
      {pts.map((p,i)=>{ const col=EC[p.emotion]||C.green, h=hov===i; return (
        <g key={i} onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)} style={{ cursor:"default" }}>
          {h&&<rect x={p.x-42} y={p.y-28} width={84} height={15} rx={3} fill={C.s4} stroke={C.border} strokeWidth={1}/>}
          {h&&<text x={p.x} y={p.y-17} textAnchor="middle" fill={col} fontSize={7} fontFamily={F.ui} fontWeight={700}>{p.label} · {p.emotion}</text>}
          <circle cx={p.x} cy={p.y} r={h?5:3.5} fill={col} stroke={C.bg} strokeWidth={1.5} style={{ transition:"r 0.15s" }}/>
          <text x={p.x} y={H-3} textAnchor="middle" fill={C.muted} fontSize={7} fontFamily={F.mono}>{i+1}</text>
        </g>
      );})}
    </svg>
  );
}

function RetentionBars({ curve }) {
  if (!curve?.length) return null;
  const avg = Math.round(curve.reduce((a,b)=>a+b,0)/curve.length);
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:9 }}>
        <span style={{ fontSize:8.5, color:C.muted, fontFamily:F.ui, fontWeight:700, letterSpacing:"0.1em" }}>SWIPE RETENTION</span>
        <span style={{ fontSize:8.5, color:C.textMid, fontFamily:F.mono }}>avg {avg}%</span>
      </div>
      {curve.map((v,i)=>{ const col=v>=80?C.green:v>=60?C.warn:C.danger; return (
        <div key={i} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:7 }}>
          <span style={{ fontSize:8, color:C.muted, fontFamily:F.mono, minWidth:14 }}>S{i+1}</span>
          <div style={{ flex:1, height:4, background:C.s4, borderRadius:2 }}>
            <div style={{ height:"100%", background:col, borderRadius:2, width:`${v}%`, transition:`width ${1+i*0.12}s cubic-bezier(0.34,1.56,0.64,1)` }}/>
          </div>
          <span style={{ fontSize:9, color:col, fontFamily:F.mono, fontWeight:700, minWidth:30, textAlign:"right" }}>{v}%</span>
        </div>
      );})}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION G — PANEL COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
function CalendarPanel({ scheduled, onSchedule, onLoad, hasCarousel }) {
  const today=new Date(); today.setHours(0,0,0,0);
  const days=Array.from({length:21},(_,i)=>{ const d=new Date(today); d.setDate(today.getDate()+i); return d; });
  return (
    <div style={{ width:"100%", maxWidth:480 }}>
      <div style={{ fontSize:9, color:C.muted, fontFamily:F.ui, fontWeight:700, letterSpacing:"0.1em", marginBottom:14 }}>21-DAY CONTENT CALENDAR</div>
      {!hasCarousel&&<div style={{ marginBottom:14, padding:"9px 12px", background:C.s3, border:`1px solid ${C.border}`, borderRadius:8, fontSize:10.5, color:C.muted, fontFamily:F.body }}>Generate a carousel to schedule it on any date below.</div>}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:5, marginBottom:20 }}>
        {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=><div key={d} style={{ textAlign:"center", fontSize:7.5, color:C.muted, fontFamily:F.ui, fontWeight:700, paddingBottom:6 }}>{d}</div>)}
        {Array.from({length:days[0].getDay()},(_,i)=><div key={`p${i}`}/>)}
        {days.map((d,i)=>{ const key=d.toISOString().split("T")[0], item=scheduled.find(s=>s.date===key), isToday=i===0; return (
          <button key={key} onClick={()=>item?onLoad(item):(hasCarousel&&onSchedule(key))} style={{ aspectRatio:"1", borderRadius:7, border:`1px solid ${item?C.green:isToday?C.borderHi:C.border}`, background:item?C.greenDim:isToday?C.s4:C.s3, cursor:item||hasCarousel?"pointer":"default", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:2, transition:"all 0.15s" }}
            onMouseEnter={e=>{if(hasCarousel||item)e.currentTarget.style.borderColor=C.green;}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor=item?C.green:isToday?C.borderHi:C.border;}}
          ><span style={{ fontSize:12, color:item?C.green:isToday?C.text:C.textMid, fontFamily:F.ui, fontWeight:700 }}>{d.getDate()}</span>{item&&<div style={{ width:4, height:4, borderRadius:"50%", background:C.green }}/>}</button>
        );})}
      </div>
      {scheduled.length>0&&(<>
        <div style={{ fontSize:9, color:C.muted, fontFamily:F.ui, fontWeight:700, letterSpacing:"0.1em", marginBottom:10 }}>SCHEDULED POSTS</div>
        {scheduled.map((s,i)=>(
          <button key={i} onClick={()=>onLoad(s)} style={{ display:"flex", alignItems:"center", gap:10, width:"100%", background:C.s3, border:`1px solid ${C.border}`, borderRadius:8, padding:"9px 12px", marginBottom:6, cursor:"pointer", textAlign:"left", transition:"border-color 0.15s" }}
            onMouseEnter={e=>(e.currentTarget.style.borderColor=C.borderHi)}
            onMouseLeave={e=>(e.currentTarget.style.borderColor=C.border)}
          >
            <div style={{ width:3, alignSelf:"stretch", background:C.green, borderRadius:2, flexShrink:0 }}/>
            <div style={{ flex:1, overflow:"hidden" }}>
              <div style={{ fontSize:10.5, color:C.text, fontFamily:F.body, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.brief}</div>
              <div style={{ fontSize:8.5, color:C.muted, fontFamily:F.mono, marginTop:2 }}>{shortDate(s.date)}</div>
            </div>
            {s.score!=null&&<span style={{ fontSize:9.5, color:C.green, fontFamily:F.mono, fontWeight:700 }}>{s.score?.toFixed(1)}</span>}
          </button>
        ))}
      </>)}
    </div>
  );
}

function ExportPanel({ slides, caption, tags, brief, score, format }) {
  const [copied,setCopied]=useState(null);
  const [genBrief,setGB]=useState(false);
  const [dBrief,setDB]=useState("");

  const copy=(text,label)=>{ navigator.clipboard.writeText(text).then(()=>{ setCopied(label); setTimeout(()=>setCopied(null),1800); }); };

  const generateDesignBrief=async()=>{
    if(genBrief||!slides.length) return;
    setGB(true); setDB("");
    try {
      const result = await apiCall("designer-brief", { slides, brief, format, score });
      setDB(result.brief || "");
    } catch(e) { setDB(`Error: ${e.message}`); }
    setGB(false);
  };

  const CBtn=({label,value,meta})=>(
    <button onClick={()=>copy(value,label)} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", width:"100%", padding:"10px 12px", marginBottom:6, background:copied===label?C.greenDim:C.s3, border:`1px solid ${copied===label?"rgba(0,204,133,0.3)":C.border}`, borderRadius:7, cursor:"pointer", fontSize:10, color:copied===label?C.green:C.text, fontFamily:F.ui, fontWeight:700, letterSpacing:"0.05em", transition:"all 0.15s" }}>
      <span>{copied===label?"Copied — ":"Copy "}{label}</span>
      <span style={{ fontSize:8, color:C.muted, fontFamily:F.mono }}>{meta}</span>
    </button>
  );

  const slideText=slides.map((s,i)=>`Slide ${i+1} [${s.type.toUpperCase()}]\n${s.headline}\n${s.body||""}${s.stat?"\n"+s.stat:""}`).join("\n\n");
  const captionFull=caption?`${caption}\n\n${tags.map(t=>`#${t}`).join(" ")}`:"";
  const figmaTokens=JSON.stringify({colors:{primary:"#FF5500",accent:"#00CC85",bg:"#03040A"},slides:slides.map(s=>({type:s.type,headline:s.headline,body:s.body}))},null,2);

  return (
    <div>
      <div style={{ fontSize:9, color:C.muted, fontFamily:F.ui, fontWeight:700, letterSpacing:"0.1em", marginBottom:12 }}>EXPORT OPTIONS</div>
      {slideText&&<CBtn label="Slide Content" value={slideText} meta={`${slides.length} slides`}/>}
      {captionFull&&<CBtn label="Caption + Hashtags" value={captionFull} meta={`${tags.length} tags`}/>}
      <CBtn label="Figma Design Tokens" value={figmaTokens} meta="JSON"/>
      <div style={{ marginTop:16, paddingTop:14, borderTop:`1px solid ${C.border}` }}>
        <div style={{ fontSize:9, color:C.muted, fontFamily:F.ui, fontWeight:700, letterSpacing:"0.1em", marginBottom:10 }}>DESIGNER HANDOFF BRIEF</div>
        <button onClick={generateDesignBrief} disabled={genBrief||!slides.length} style={{ width:"100%", padding:"10px", background:genBrief?C.s3:C.orangeDim, border:`1px solid ${genBrief?C.border:"rgba(255,85,0,0.28)"}`, borderRadius:8, cursor:genBrief||!slides.length?"not-allowed":"pointer", fontSize:10, color:genBrief?C.muted:C.orange, fontFamily:F.ui, fontWeight:700, letterSpacing:"0.07em", marginBottom:dBrief?8:0, transition:"all 0.15s" }}>
          {genBrief?"GENERATING...":"GENERATE BRIEF"}
        </button>
        {dBrief&&<>
          <div style={{ background:C.s3, border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 13px", fontSize:11, color:C.textMid, fontFamily:F.body, lineHeight:1.8, marginBottom:7 }}>{dBrief}</div>
          <CBtn label="Designer Brief" value={dBrief} meta="prose"/>
        </>}
      </div>
    </div>
  );
}

function HeadlinesPanel({ slides, active, setActive, alts, loadingAlt, onGenerate, onSwap }) {
  if (!slides.length) return (
    <div style={{ textAlign:"center", color:C.muted, marginTop:44 }}>
      <div style={{ fontSize:12, fontFamily:F.ui, fontWeight:700, color:C.textMid, marginBottom:6 }}>Headline Workshop</div>
      <div style={{ fontSize:10, lineHeight:1.8 }}>Generate a carousel to create alternative headlines for each slide</div>
    </div>
  );
  const sl=slides[active]; if(!sl) return null;
  const ssp=scrollStopScore(sl), sCol=ssp>=8?C.green:ssp>=6?C.warn:C.danger;
  return (
    <div>
      <div style={{ display:"flex", gap:3, flexWrap:"wrap", marginBottom:14 }}>
        {slides.map((_,i)=><button key={i} onClick={()=>setActive(i)} style={{ padding:"3px 8px", borderRadius:4, cursor:"pointer", background:i===active?C.s5:"transparent", border:`1px solid ${i===active?C.borderHi:C.border}`, fontSize:8.5, color:i===active?C.text:C.muted, fontFamily:F.ui, fontWeight:700, transition:"all 0.15s" }}>S{i+1}</button>)}
      </div>
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:8.5, color:C.muted, fontFamily:F.ui, fontWeight:700, letterSpacing:"0.1em", marginBottom:7 }}>SLIDE {active+1} — {sl.type?.toUpperCase()}</div>
        <div style={{ background:C.greenDim, border:"1px solid rgba(0,204,133,0.2)", borderRadius:8, padding:"10px 12px", fontSize:13, color:C.green, fontFamily:F.display, lineHeight:1.25, marginBottom:7 }}>{sl.headline}</div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:8.5, color:C.muted, fontFamily:F.ui, fontWeight:700 }}>SCROLL-STOP</span>
          <div style={{ flex:1, height:3, background:C.s4, borderRadius:2 }}><div style={{ height:"100%", background:sCol, borderRadius:2, width:`${ssp*10}%`, transition:"width 0.6s ease" }}/></div>
          <span style={{ fontSize:8.5, color:sCol, fontFamily:F.mono, fontWeight:700 }}>{ssp}/10</span>
        </div>
        <div style={{ marginTop:5, fontSize:8.5, color:C.muted, fontFamily:F.body }}>{sl.headline?.trim().split(/\s+/).length} words</div>
      </div>
      {alts.has(active)?(
        <>
          <div style={{ fontSize:8.5, color:C.muted, fontFamily:F.ui, fontWeight:700, letterSpacing:"0.1em", marginBottom:8 }}>ALTERNATIVES</div>
          {alts.get(active).map((h,i)=>(
            <button key={i} onClick={()=>onSwap(active,h)} style={{ display:"block", width:"100%", textAlign:"left", background:C.s3, border:`1px solid ${C.border}`, borderRadius:8, padding:"9px 11px", marginBottom:5, fontSize:11.5, color:C.text, fontFamily:F.body, cursor:"pointer", lineHeight:1.35, transition:"border-color 0.15s" }}
              onMouseEnter={e=>(e.currentTarget.style.borderColor=C.borderHi)}
              onMouseLeave={e=>(e.currentTarget.style.borderColor=C.border)}
            >
              <div style={{ fontSize:7.5, color:C.muted, fontFamily:F.ui, fontWeight:700, marginBottom:3, letterSpacing:"0.06em" }}>VARIANT {i+1}</div>
              {h}
            </button>
          ))}
          <button onClick={()=>onGenerate(active)} disabled={loadingAlt!==null} style={{ width:"100%", padding:"8px", marginTop:3, background:"transparent", border:`1px solid ${C.border}`, borderRadius:7, cursor:"pointer", fontSize:9, color:C.muted, fontFamily:F.ui, fontWeight:700, letterSpacing:"0.06em" }}>REGENERATE</button>
        </>
      ):(
        <button onClick={()=>onGenerate(active)} disabled={loadingAlt!==null} style={{ width:"100%", padding:"11px", background:loadingAlt!==null?C.s3:C.violetDim, border:`1px solid ${loadingAlt!==null?C.border:"rgba(139,127,255,0.3)"}`, borderRadius:8, cursor:loadingAlt!==null?"not-allowed":"pointer", fontSize:10, color:loadingAlt!==null?C.muted:C.violet, fontFamily:F.ui, fontWeight:700, letterSpacing:"0.07em", transition:"all 0.15s" }}>
          {loadingAlt===active?"GENERATING...":"GENERATE ALTERNATIVES"}
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION H — MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function Studio() {
  const [brief,setBrief]           = useState("");
  const [format,setFormat]         = useState("instagram");
  const [slides,setSlides]         = useState([]);
  const [abSlides,setAbSlides]     = useState([]);
  const [active,setActive]         = useState(0);
  const [abMode,setAbMode]         = useState(false);
  const [slideTheme,setSlideTheme] = useState("dark");
  const [gen,setGen]               = useState(false);
  const [prog,setProg]             = useState(0);
  const [error,setError]           = useState("");
  const [score,setScore]           = useState(null);
  const [breakdown,setBreak]       = useState(null);
  const [tip,setTip]               = useState("");
  const [caption,setCaption]       = useState("");
  const [tags,setTags]             = useState([]);
  const [psych,setPsych]           = useState(null);
  const [arc,setArc]               = useState(null);
  const [curve,setCurve]           = useState(null);
  const [longevity,setLong]        = useState(null);
  const [longReason,setLongR]      = useState("");
  const [voiceNote,setVoice]       = useState("");
  const [compAngle,setComp]        = useState("");
  const [view,setView]             = useState("studio");
  const [rightTab,setRT]           = useState("metrics");
  const [persona,setPersona]       = useState("aspirational");
  const [tone,setTone]             = useState(40);
  const [editMode,setEM]           = useState(false);
  const [rewIdx,setRewIdx]         = useState(null);
  const [copied,setCopied]         = useState(false);
  const [enhancing,setEnh]         = useState(false);
  const [briefA,setBriefA]         = useState(null);
  const [history,setHistory]       = useState([]);
  const [scheduled,setSched]       = useState([]);
  const [headlineAlts,setHAlts]    = useState(new Map());
  const [loadingAlt,setLA]         = useState(null);
  const [showP,setShowP]           = useState(true);
  const [showT,setShowT]           = useState(false);
  const [showTh,setShowTh]         = useState(false);
  const [showTpl,setShowTpl]       = useState(false);

  // ── System design refs ──────────────────────────────────────────────────
  const reqId     = useRef(0);           // Stale request guard
  const abortCtrl = useRef(null);        // AbortController for in-flight cancel
  const cache     = useRef(new Map());   // In-memory cache (O(1) lookup)
  const errCnt    = useRef(0);           // Circuit breaker counter
  const lastErrAt = useRef(0);          // Circuit breaker timestamp
  const progTimer = useRef(null);        // Optimistic progress timer
  const debT      = useRef(null);        // Brief analysis debounce

  // ── Lazy localStorage hydration ─────────────────────────────────────────
  useEffect(() => {
    try {
      const h=localStorage.getItem("cm_history"); if(h) setHistory(JSON.parse(h));
      const s=localStorage.getItem("cm_sched");   if(s) setSched(JSON.parse(s));
    } catch {}
  }, []);

  // ── Font + CSS ───────────────────────────────────────────────────────────
  useEffect(() => {
    const link=document.createElement("link");
    link.rel="stylesheet";
    link.href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&family=Syne:wght@500;600;700;800&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&family=JetBrains+Mono:wght@400;700&display=swap";
    document.head.appendChild(link);
    const style=document.createElement("style");
    style.textContent=`
      *,*::before,*::after{box-sizing:border-box;}body{margin:0;}
      @keyframes shimmer{0%{background-position:-700px 0}100%{background-position:700px 0}}
      @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
      @keyframes fadeIn{from{opacity:0}to{opacity:1}}
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.35}}
      ::-webkit-scrollbar{width:2px;height:2px;}::-webkit-scrollbar-track{background:transparent;}::-webkit-scrollbar-thumb{background:${C.ghost};border-radius:2px;}
      textarea::placeholder{color:${C.muted};opacity:0.75;}
      input[type=range]{-webkit-appearance:none;width:100%;height:3px;border-radius:2px;background:${C.s4};outline:none;cursor:pointer;}
      input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:${C.orange};border:2px solid ${C.s1};cursor:pointer;transition:transform 0.15s;}
      input[type=range]::-webkit-slider-thumb:hover{transform:scale(1.25);}
    `;
    document.head.appendChild(style);
    const onKey=(e)=>{
      if(document.activeElement?.tagName==="TEXTAREA"||document.activeElement?.tagName==="INPUT") return;
      if(e.key==="ArrowLeft")  setActive(a=>Math.max(0,a-1));
      if(e.key==="ArrowRight") setActive(a=>Math.min(99,a+1));
      if(e.key==="e"||e.key==="E") setEM(v=>!v);
      if(e.key==="Escape") setEM(false);
    };
    window.addEventListener("keydown",onKey);
    return()=>{ window.removeEventListener("keydown",onKey); clearInterval(progTimer.current); clearTimeout(debT.current); };
  }, []);

  // ── Debounced brief analysis ─────────────────────────────────────────────
  useEffect(() => {
    clearTimeout(debT.current);
    debT.current=setTimeout(()=>setBriefA(analyzeBrief(brief)),DEBOUNCE_DELAY_MS);
  }, [brief]);

  // ── Apply result to state ────────────────────────────────────────────────
  const applyResult=useCallback((r,isAb=false)=>{
    if(isAb){ setAbSlides(r.slides||[]); setAbMode(true); return; }
    setSlides(r.slides||[]); setScore(r.engagement_score??null); setBreak(r.engagement_breakdown??null);
    setTip(r.engagement_tip||""); setCaption(r.caption||""); setTags(r.hashtags||[]);
    setPsych(r.psychological_profile??null); setArc(r.narrative_arc??null); setCurve(r.retention_curve??null);
    setLong(r.content_longevity??null); setLongR(r.longevity_reason??""); setVoice(r.brand_voice_notes??""); setComp(r.competitive_angle??"");
    setActive(0); setAbSlides([]); setAbMode(false); setHAlts(new Map()); setEM(false);
  },[]);

  // ── GENERATE — implements all 5 system design patterns ──────────────────
  const generate=useCallback(async(txt,isAb=false)=>{
    const text=txt.trim();
    if(!text||gen) return;

    // [3] CIRCUIT BREAKER
    const elapsed=Date.now()-lastErrAt.current;
    if(errCnt.current>=CB_MAX_ERRORS&&elapsed<CB_COOLDOWN_MS){
      const rem=Math.ceil((CB_COOLDOWN_MS-elapsed)/1000);
      setError(`Rate limit cooldown — retry in ${rem}s`);
      const iv=setInterval(()=>{ const r2=Math.ceil((CB_COOLDOWN_MS-(Date.now()-lastErrAt.current))/1000); if(r2<=0){clearInterval(iv);setError("");errCnt.current=0;}else setError(`Rate limit cooldown — retry in ${r2}s`); },1000);
      return;
    }

    // [1, 2] REQUEST DEDUPLICATION + CACHE
    const ck=`${text}::${format}::${persona}::${tone}::${isAb}`;
    if(!isAb&&cache.current.has(ck)){ applyResult(cache.current.get(ck)); return; }

    // [5] STALE REQUEST GUARD
    if(abortCtrl.current) abortCtrl.current.abort();
    abortCtrl.current=new AbortController();
    const myId=++reqId.current;

    setGen(true); setError(""); setProg(0);
    if(!isAb){ setSlides([]); setScore(null); setAbSlides([]); setPsych(null); setArc(null); setCurve(null); }

    // [4] OPTIMISTIC UI
    clearInterval(progTimer.current);
    progTimer.current=setInterval(()=>setProg(p=>Math.min(p+Math.random()*6+2,88)),320);

    try {
      const result=await apiCall("carousel",{ brief:text, personaId:persona, tone, formatKey:format, isAb }, abortCtrl.current.signal);
      if(myId!==reqId.current) return; // stale guard check
      if(isAb){ applyResult(result,true); }
      else {
        cache.current.set(ck,result);
        applyResult(result);
        setHistory(h=>{ const next=[{brief:text,score:result.engagement_score,persona,tone},...h.filter(x=>x.brief!==text)].slice(0,6); try{localStorage.setItem("cm_history",JSON.stringify(next));}catch{} return next; });
      }
      errCnt.current=0;
    } catch(e){
      if(e.name==="AbortError") return;
      if(myId!==reqId.current) return;
      errCnt.current++; lastErrAt.current=Date.now();
      // Map error codes to human-readable, actionable messages
      const errorMessages = {
        // New unified AI codes
        "AI_NO_KEY":       "API key missing — add GROQ_API_KEY or GEMINI_API_KEY in Vercel environment variables",
        "AI_RATE_LIMIT":   "The AI service is busy — retried automatically. Please try again in a few seconds.",
        "AI_TIMEOUT":      "Request timed out — please try again",
        "AI_INVALID_JSON": "Unexpected AI response — please try again",
        "AI_EMPTY":        "AI returned an empty response — please try again",
        "AI_UPSTREAM":     "AI service error — please try again",
        // Legacy Gemini codes (kept for backwards compat)
        "GEMINI_NO_KEY":       "API key missing — add GEMINI_API_KEY to environment variables",
        "GEMINI_RATE_LIMIT":   "Rate limited — the server will auto-retry. Please try again in a moment.",
        "GEMINI_TIMEOUT":      "Request timed out — please try again",
        "GEMINI_INVALID_JSON": "Unexpected response — please try again",
        "GEMINI_EMPTY":        "Empty response — please try again",
        "GEMINI_UPSTREAM":     "AI service error — please try again",
        "INVALID_BODY":        "Invalid request — refresh the page and try again",
      };
      const msg =
        e.status===429 ? "The AI service is busy right now — please wait a few seconds and try again." :
        e.status===401 ? "API key invalid — check your key in Vercel environment variables" :
        e.status===403 ? "API key permission error — check your key" :
        e.status===504 ? "Request timed out — please try again" :
        e.status===500 ? "Server error — check your API key in Vercel settings" :
        errorMessages[e.code] || e.message || "Generation failed — please try again";
      setError(msg);
    } finally {
      clearInterval(progTimer.current);
      if(myId===reqId.current){ setGen(false); setProg(0); }
    }
  },[gen,format,persona,tone,applyResult]);

  const rewriteSlide=useCallback(async(idx)=>{
    if(rewIdx!==null||gen) return;
    setRewIdx(idx);
    try {
      const sl=slides[idx];
      const result=await apiCall("rewrite",{ slideType:sl.type, headline:sl.headline, body:sl.body||"", brief });
      setSlides(s=>s.map((x,i)=>i===idx?{...x,...result}:x));
    } catch(e){ console.error("Rewrite failed:",e.message); }
    setRewIdx(null);
  },[rewIdx,gen,slides,brief]);

  const enhanceBrief=useCallback(async()=>{
    if(!brief.trim()||enhancing) return;
    setEnh(true);
    try { const r=await apiCall("enhance",{brief}); setBrief(r.enhanced||brief); }
    catch(e){ console.error("Enhance failed:",e.message); }
    setEnh(false);
  },[brief,enhancing]);

  const generateAlts=useCallback(async(idx)=>{
    if(loadingAlt!==null) return;
    const sl=slides[idx]; if(!sl) return;
    setLA(idx);
    try {
      const r=await apiCall("alternatives",{ slideType:sl.type, headline:sl.headline, body:sl.body||"", brief });
      if(r.alternatives?.length) setHAlts(prev=>new Map(prev).set(idx,r.alternatives));
    } catch(e){ console.error("Alts failed:",e.message); }
    setLA(null);
  },[slides,loadingAlt,brief]);

  const swapHeadline=useCallback((idx,h)=>{
    setSlides(s=>s.map((sl,i)=>i===idx?{...sl,headline:h}:sl));
    setHAlts(prev=>{ const n=new Map(prev); n.delete(idx); return n; });
  },[]);

  const onFieldEdit=useCallback((idx,field,value)=>{
    setSlides(s=>s.map((sl,i)=>i===idx?{...sl,[field]:value}:sl));
  },[]);

  const copyCaption=useCallback(()=>{
    navigator.clipboard.writeText(caption+"\n\n"+tags.map(t=>`#${t}`).join(" "));
    setCopied(true); setTimeout(()=>setCopied(false),2200);
  },[caption,tags]);

  const scheduleCarousel=useCallback((dateKey)=>{
    setSched(prev=>{ const next=[...prev.filter(s=>s.date!==dateKey),{date:dateKey,brief,score,slides,caption,tags}]; try{localStorage.setItem("cm_sched",JSON.stringify(next));}catch{} return next; });
    setView("calendar");
  },[brief,score,slides,caption,tags]);

  const loadScheduled=useCallback((item)=>{
    setBrief(item.brief||""); setSlides(item.slides||[]); setCaption(item.caption||""); setTags(item.tags||[]); setScore(item.score??null); setActive(0); setView("studio");
  },[]);

  const fmt=FORMATS[format], hasSlides=slides.length>0, curSlides=abMode?abSlides:slides;
  const curP=PERSONAS.find(p=>p.id===persona);
  const LC={evergreen:C.green,seasonal:C.warn,trending:C.violet};

  const navBtn=v=>({ padding:"4px 12px", borderRadius:5, border:"none", cursor:"pointer", background:view===v?C.s1:"transparent", color:view===v?C.text:C.muted, fontSize:9, fontFamily:F.ui, fontWeight:700, letterSpacing:"0.07em", transition:"all 0.15s" });
  const rTab=v=>({ flex:1, padding:"7px 2px", border:"none", cursor:"pointer", background:"transparent", color:rightTab===v?C.text:C.muted, fontSize:8, fontFamily:F.ui, fontWeight:700, letterSpacing:"0.05em", borderBottom:`2px solid ${rightTab===v?C.orange:"transparent"}`, transition:"all 0.15s" });
  const fmtBtn=k=>({ padding:"4px 10px", borderRadius:5, border:"none", cursor:"pointer", background:format===k?C.orange:"transparent", color:format===k?"#fff":C.muted, fontSize:9, fontFamily:F.ui, fontWeight:700, letterSpacing:"0.04em", transition:"all 0.15s" });

  const SecHdr=({label,open,set,right})=>(
    <button onClick={()=>set(v=>!v)} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", width:"100%", background:"none", border:"none", cursor:"pointer", padding:"0 0 8px", fontSize:8.5, fontFamily:F.ui, fontWeight:700, color:C.muted, letterSpacing:"0.12em" }}>
      <span>{label}</span>
      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
        {right}
        <span style={{ fontSize:8, transform:open?"rotate(180deg)":"none", display:"inline-block", transition:"transform 0.2s" }}>▾</span>
      </div>
    </button>
  );

  return (
    <div style={{ minHeight:"100vh", background:C.bg, color:C.text, fontFamily:F.body, display:"flex", flexDirection:"column" }}>

      {/* TOPNAV */}
      <nav style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 20px", height:50, borderBottom:`1px solid ${C.border}`, background:C.s1, position:"sticky", top:0, zIndex:100 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:30, height:30, borderRadius:7, background:C.orange, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:800, color:"#fff", fontFamily:F.display, boxShadow:`0 0 18px ${C.orangeGlow}` }}>C</div>
          <div>
            <div style={{ fontSize:12.5, fontWeight:700, fontFamily:F.ui, color:C.text, lineHeight:1.1 }}>Social Studio</div>
            <div style={{ fontSize:7.5, color:C.muted, fontFamily:F.ui, fontWeight:700, letterSpacing:"0.14em" }}>CUEMATH CONTENT PLATFORM</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:3, background:C.s3, borderRadius:7, padding:"3px" }}>
          {Object.entries(FORMATS).map(([k])=><button key={k} onClick={()=>setFormat(k)} style={fmtBtn(k)} title={FORMATS[k].hint}>{FORMATS[k].label} <span style={{ fontSize:7.5, opacity:0.6, marginLeft:3 }}>{FORMATS[k].sub}</span></button>)}
        </div>
        <div style={{ display:"flex", gap:2, background:C.s3, borderRadius:7, padding:"3px" }}>
          <button style={navBtn("studio")}   onClick={()=>setView("studio")}>STUDIO</button>
          <button style={navBtn("caption")}  onClick={()=>setView("caption")}>CAPTION</button>
          <button style={navBtn("calendar")} onClick={()=>setView("calendar")}>CALENDAR</button>
        </div>
      </nav>

      <div style={{ display:"flex", flex:1, overflow:"hidden" }}>

        {/* LEFT PANEL */}
        <div style={{ width:272, flexShrink:0, borderRight:`1px solid ${C.border}`, background:C.s1, display:"flex", flexDirection:"column", overflowY:"auto" }}>
          <div style={{ padding:"16px 14px 0" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:7 }}>
              <span style={{ fontSize:8.5, color:C.muted, fontFamily:F.ui, fontWeight:700, letterSpacing:"0.12em" }}>BRIEF</span>
              {briefA&&<span style={{ fontSize:8, color:briefA.quality.col, fontFamily:F.mono, fontWeight:700 }}>{briefA.quality.label} · {briefA.words}w</span>}
            </div>
            <textarea value={brief} onChange={e=>setBrief(e.target.value)} onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==="Enter")generate(brief);}} placeholder={"Describe your carousel concept...\n\nCmd+Enter to generate"} style={{ width:"100%", height:110, background:C.s2, border:`1px solid ${C.border}`, borderRadius:8, color:C.text, fontSize:11.5, fontFamily:F.body, padding:"10px 12px", resize:"none", outline:"none", lineHeight:1.7, transition:"border-color 0.15s" }} onFocus={e=>(e.target.style.borderColor=C.borderFocus)} onBlur={e=>(e.target.style.borderColor=C.border)}/>
            {briefA&&<div style={{ height:2, background:C.s3, borderRadius:1, marginTop:5, overflow:"hidden" }}><div style={{ height:"100%", background:briefA.quality.col, borderRadius:1, width:`${briefA.specificity*10}%`, transition:"width 0.4s ease" }}/></div>}
            {error&&<div style={{ fontSize:10, color:C.danger, marginTop:6, fontFamily:F.body, animation:"fadeIn 0.2s ease" }}>{error}</div>}

            <button onClick={()=>generate(brief)} disabled={gen||!brief.trim()} style={{ width:"100%", marginTop:9, padding:"11px", background:gen||!brief.trim()?C.s3:C.orange, color:gen||!brief.trim()?C.muted:"#fff", border:"none", borderRadius:8, fontSize:11, fontFamily:F.ui, fontWeight:800, cursor:gen||!brief.trim()?"not-allowed":"pointer", letterSpacing:"0.07em", transition:"all 0.18s", boxShadow:gen||!brief.trim()?"none":`0 0 20px ${C.orangeGlow}` }}>
              {gen?"GENERATING...":"GENERATE CAROUSEL"}
            </button>

            {brief.trim().length>10&&!gen&&(
              <button onClick={enhanceBrief} disabled={enhancing} style={{ width:"100%", marginTop:5, padding:"8px", background:"transparent", color:enhancing?C.muted:C.violet, border:`1px solid ${enhancing?C.border:"rgba(139,127,255,0.3)"}`, borderRadius:8, fontSize:9.5, fontFamily:F.ui, fontWeight:700, cursor:enhancing?"not-allowed":"pointer", letterSpacing:"0.06em", transition:"all 0.15s" }}>
                {enhancing?"ENHANCING...":"ENHANCE BRIEF WITH AI"}
              </button>
            )}
            {hasSlides&&!gen&&(
              <button onClick={()=>generate(brief,true)} style={{ width:"100%", marginTop:5, padding:"8px", background:"transparent", color:C.muted, border:`1px solid ${C.border}`, borderRadius:8, fontSize:9.5, fontFamily:F.ui, fontWeight:700, cursor:"pointer", letterSpacing:"0.06em", transition:"all 0.15s" }}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=C.borderHi;e.currentTarget.style.color=C.text;}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.color=C.muted;}}
              >GENERATE A/B VARIANT</button>
            )}
            {gen&&<div style={{ marginTop:9, height:2, background:C.s3, borderRadius:1, overflow:"hidden" }}><div style={{ height:"100%", background:C.orange, borderRadius:1, width:`${prog}%`, transition:"width 0.32s ease" }}/></div>}
          </div>

          {/* Persona */}
          <div style={{ padding:"14px 14px 0" }}>
            <SecHdr label="AUDIENCE PERSONA" open={showP} set={setShowP} right={!showP&&<><div style={{ width:5,height:5,borderRadius:"50%",background:curP?.col }}/><span style={{ fontSize:8.5,color:curP?.col }}>{curP?.label}</span></>}/>
            {showP&&<div style={{ animation:"fadeIn 0.18s ease" }}>{PERSONAS.map(p=>(
              <button key={p.id} onClick={()=>setPersona(p.id)} style={{ display:"block", width:"100%", textAlign:"left", background:persona===p.id?`${p.col}09`:C.s2, border:`1px solid ${persona===p.id?p.col+"30":C.border}`, borderRadius:7, padding:"7px 9px", marginBottom:4, cursor:"pointer", transition:"all 0.15s" }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:2 }}><div style={{ width:5,height:5,borderRadius:"50%",background:p.col }}/><span style={{ fontSize:10.5,color:persona===p.id?p.col:C.text,fontFamily:F.ui,fontWeight:700 }}>{p.label}</span><span style={{ fontSize:8.5,color:C.muted,fontFamily:F.body,marginLeft:"auto" }}>{p.sub}</span></div>
                <div style={{ fontSize:9.5,color:C.muted,fontFamily:F.body,lineHeight:1.5,paddingLeft:11 }}>{p.desc}</div>
              </button>
            ))}</div>}
          </div>

          {/* Tone */}
          <div style={{ padding:"12px 14px 0" }}>
            <SecHdr label="TONE CALIBRATION" open={showT} set={setShowT} right={!showT&&<span style={{ fontSize:8.5,color:C.textMid }}>{toneLabel(tone)}</span>}/>
            {showT&&<div style={{ paddingBottom:12, animation:"fadeIn 0.18s ease" }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}><span style={{ fontSize:8.5,color:C.muted,fontFamily:F.body }}>Empathetic</span><span style={{ fontSize:8.5,color:C.muted,fontFamily:F.body }}>Scientific</span></div>
              <input type="range" min={0} max={100} value={tone} onChange={e=>setTone(Number(e.target.value))}/>
              <div style={{ marginTop:7, textAlign:"center", fontSize:10, color:C.textMid, fontFamily:F.ui, fontWeight:700 }}>{toneLabel(tone)} · {tone}/100</div>
            </div>}
          </div>

          {/* Theme */}
          <div style={{ padding:"12px 14px 0" }}>
            <SecHdr label="SLIDE COLOUR THEME" open={showTh} set={setShowTh}/>
            {showTh&&<div style={{ display:"flex", gap:6, marginBottom:12, animation:"fadeIn 0.18s ease" }}>
              {SLIDE_THEMES.map(t=>(
                <button key={t.id} onClick={()=>setSlideTheme(t.id)} style={{ flex:1, padding:"7px 4px", borderRadius:7, cursor:"pointer", border:`1px solid ${slideTheme===t.id?t.accent:C.border}`, background:slideTheme===t.id?`${t.accent}11`:C.s2, transition:"all 0.15s" }}>
                  <div style={{ width:"100%", height:16, borderRadius:4, background:`linear-gradient(90deg,${t.accent},${t.accent2})`, marginBottom:4, opacity:0.8 }}/>
                  <div style={{ fontSize:8.5, color:slideTheme===t.id?t.accent:C.muted, fontFamily:F.ui, fontWeight:700 }}>{t.label}</div>
                </button>
              ))}
            </div>}
          </div>

          {/* Templates */}
          <div style={{ padding:"12px 14px 0" }}>
            <SecHdr label="QUICK START" open={showTpl} set={setShowTpl}/>
            {showTpl&&<div style={{ animation:"fadeIn 0.18s ease" }}>{TEMPLATES.map(t=>(
              <button key={t.label} onClick={()=>{ setBrief(t.brief); setShowTpl(false); }} style={{ display:"block", width:"100%", textAlign:"left", background:C.s2, border:`1px solid ${C.border}`, borderRadius:7, padding:"7px 10px", marginBottom:4, cursor:"pointer", fontSize:10.5, color:C.text, fontFamily:F.body, lineHeight:1.4, transition:"border-color 0.15s" }}
                onMouseEnter={e=>(e.currentTarget.style.borderColor=C.borderHi)}
                onMouseLeave={e=>(e.currentTarget.style.borderColor=C.border)}
              >{t.label}</button>
            ))}</div>}
          </div>

          {/* History */}
          {history.length>0&&<div style={{ padding:"12px 14px 20px" }}>
            <div style={{ fontSize:8.5,fontFamily:F.ui,fontWeight:700,color:C.muted,letterSpacing:"0.12em",marginBottom:9 }}>RECENT</div>
            {history.map((h,i)=>{ const p=PERSONAS.find(x=>x.id===h.persona); return (
              <button key={i} onClick={()=>{ setBrief(h.brief); generate(h.brief); }} style={{ display:"flex", alignItems:"center", gap:7, width:"100%", background:"none", border:"none", cursor:"pointer", padding:"6px 0", borderBottom:`1px solid ${C.border}`, textAlign:"left" }}
                onMouseEnter={e=>(e.currentTarget.style.opacity="0.7")} onMouseLeave={e=>(e.currentTarget.style.opacity="1")}
              >
                {p&&<div style={{ width:4,height:4,borderRadius:"50%",background:p.col,flexShrink:0 }}/>}
                <span style={{ fontSize:9.5,color:C.muted,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontFamily:F.body }}>{h.brief}</span>
                {h.score!=null&&<span style={{ fontSize:8.5,color:C.green,fontFamily:F.mono,fontWeight:700,flexShrink:0 }}>{h.score?.toFixed(1)}</span>}
              </button>
            );})}
          </div>}
        </div>

        {/* CENTER CANVAS */}
        <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", overflowY:"auto", padding:"28px 22px", background:C.bg }}>
          {view==="studio"&&(<>
            {abSlides.length>0&&<div style={{ display:"flex", gap:4, marginBottom:16, background:C.s2, borderRadius:7, padding:"3px", animation:"fadeIn 0.2s ease" }}>
              <button onClick={()=>setAbMode(false)} style={{ padding:"4px 16px", borderRadius:5, border:"none", cursor:"pointer", background:!abMode?C.green:"transparent", color:!abMode?"#000":C.muted, fontSize:9, fontFamily:F.ui, fontWeight:800, letterSpacing:"0.06em", transition:"all 0.15s" }}>VERSION A</button>
              <button onClick={()=>setAbMode(true)} style={{ padding:"4px 16px", borderRadius:5, border:"none", cursor:"pointer", background:abMode?C.green:"transparent", color:abMode?"#000":C.muted, fontSize:9, fontFamily:F.ui, fontWeight:800, letterSpacing:"0.06em", transition:"all 0.15s" }}>VERSION B</button>
            </div>}
            {hasSlides&&<div style={{ display:"flex", gap:6, marginBottom:16, alignSelf:"flex-end", animation:"fadeIn 0.2s ease" }}>
              <button onClick={()=>setEM(v=>!v)} style={{ padding:"5px 12px", borderRadius:5, cursor:"pointer", background:editMode?C.violetDim:"transparent", border:`1px solid ${editMode?"rgba(139,127,255,0.35)":C.border}`, fontSize:9, color:editMode?C.violet:C.muted, fontFamily:F.ui, fontWeight:700, letterSpacing:"0.06em", transition:"all 0.15s" }}>{editMode?"EXIT EDIT  (E)":"EDIT SLIDES  (E)"}</button>
              <button onClick={()=>setView("calendar")} style={{ padding:"5px 12px", borderRadius:5, cursor:"pointer", background:"transparent", border:`1px solid ${C.border}`, fontSize:9, color:C.muted, fontFamily:F.ui, fontWeight:700, letterSpacing:"0.06em", transition:"all 0.15s" }}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=C.borderHi;e.currentTarget.style.color=C.text;}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.color=C.muted;}}
              >SCHEDULE POST</button>
            </div>}

            {/* Slide canvas */}
            <div style={{ background:C.s2, borderRadius:20, padding:28, border:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:18, position:"relative", minWidth:fmt.w+60, minHeight:fmt.h+60, boxShadow:`0 0 0 1px ${C.border},0 24px 60px rgba(0,0,0,0.5)` }}>
              {gen&&!hasSlides?(
                <div style={{ width:fmt.w, height:fmt.h, borderRadius:18, background:`linear-gradient(90deg,${C.s3} 25%,${C.s4} 50%,${C.s3} 75%)`, backgroundSize:"900px 100%", animation:"shimmer 1.4s infinite linear" }}/>
              ):hasSlides?(
                <div style={{ position:"relative" }}>
                  <div key={`${active}-${abMode}`} style={{ animation:"fadeUp 0.25s ease" }}>
                    <SlideVisual slide={curSlides[Math.min(active,curSlides.length-1)]} format={format} total={curSlides.length} index={active} theme={slideTheme}/>
                  </div>
                  {!abMode&&!editMode&&<button onClick={()=>rewriteSlide(active)} disabled={rewIdx===active||gen} style={{ position:"absolute", top:12, right:12, background:"rgba(3,4,10,0.9)", backdropFilter:"blur(14px)", border:`1px solid ${C.border}`, borderRadius:6, padding:"4px 10px", cursor:"pointer", fontSize:8.5, color:rewIdx===active?C.green:C.muted, fontFamily:F.ui, fontWeight:700, letterSpacing:"0.07em", animation:rewIdx===active?"pulse 0.85s infinite":"none", transition:"all 0.15s" }}>{rewIdx===active?"REWRITING...":"REWRITE SLIDE"}</button>}
                  {active>0&&<button onClick={()=>setActive(a=>a-1)} style={{ position:"absolute", left:-44, top:"50%", transform:"translateY(-50%)", background:C.s3, border:`1px solid ${C.border}`, borderRadius:"50%", width:32, height:32, cursor:"pointer", color:C.text, fontSize:18, display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.15s" }}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor=C.borderHi;e.currentTarget.style.background=C.s4;}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.background=C.s3;}}
                  >‹</button>}
                  {active<curSlides.length-1&&<button onClick={()=>setActive(a=>a+1)} style={{ position:"absolute", right:-44, top:"50%", transform:"translateY(-50%)", background:C.s3, border:`1px solid ${C.border}`, borderRadius:"50%", width:32, height:32, cursor:"pointer", color:C.text, fontSize:18, display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.15s" }}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor=C.borderHi;e.currentTarget.style.background=C.s4;}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.background=C.s3;}}
                  >›</button>}
                </div>
              ):(
                <div style={{ textAlign:"center", padding:"44px 28px", animation:"fadeIn 0.4s ease" }}>
                  <div style={{ width:64, height:64, borderRadius:16, background:C.orangeDim, border:`1px solid rgba(255,85,0,0.18)`, margin:"0 auto 22px", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:`0 0 40px ${C.orangeGlow}` }}>
                    <div style={{ width:28, height:28, borderRadius:6, background:C.orange, opacity:0.9 }}/>
                  </div>
                  <div style={{ fontSize:15, fontFamily:F.ui, fontWeight:700, color:C.textMid, marginBottom:10 }}>Your carousel will appear here</div>
                  <div style={{ fontSize:11, color:C.muted, lineHeight:1.9, maxWidth:240 }}>Write a brief, configure persona and tone, then generate.</div>
                  <div style={{ marginTop:18, display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap" }}>
                    {["Cmd+Enter — generate","E — edit slides","← → — navigate"].map(h=><span key={h} style={{ fontSize:8.5, color:C.ghost, fontFamily:F.mono, background:C.s3, border:`1px solid ${C.border}`, borderRadius:4, padding:"3px 8px" }}>{h}</span>)}
                  </div>
                </div>
              )}
            </div>

            {/* Filmstrip */}
            {hasSlides&&<div style={{ display:"flex", gap:5, flexWrap:"wrap", justifyContent:"center", maxWidth:560, animation:"fadeIn 0.3s ease" }}>
              {curSlides.map((sl,i)=>(
                <button key={i} onClick={()=>setActive(i)} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4, background:i===active?C.s4:C.s2, border:`2px solid ${i===active?C.orange:C.border}`, borderRadius:8, padding:"7px 11px", cursor:"pointer", transition:"all 0.15s", minWidth:50 }}
                  onMouseEnter={e=>{if(i!==active)e.currentTarget.style.borderColor=C.borderHi;}}
                  onMouseLeave={e=>{if(i!==active)e.currentTarget.style.borderColor=C.border;}}
                ><span style={{ fontSize:18 }}>{sl.emoji}</span><span style={{ fontSize:7, fontFamily:F.ui, fontWeight:800, letterSpacing:"0.07em", textTransform:"uppercase", color:i===active?C.orange:C.muted }}>{sl.type}</span></button>
              ))}
            </div>}

            {/* Inline editor */}
            {editMode&&hasSlides&&!abMode&&<div style={{ width:"100%", maxWidth:fmt.w+60, marginTop:20, background:C.s2, border:`1px solid rgba(139,127,255,0.28)`, borderRadius:12, padding:"18px 18px 10px", animation:"fadeIn 0.2s ease" }}>
              <div style={{ fontSize:8.5, color:C.violet, fontFamily:F.ui, fontWeight:700, letterSpacing:"0.1em", marginBottom:14 }}>EDITING SLIDE {active+1} — {slides[active]?.type?.toUpperCase()}</div>
              {[{field:"headline",label:"HEADLINE (max 7 words)",multi:false},{field:"subheadline",label:"SUBHEADLINE",multi:false},{field:"body",label:"BODY COPY (25-35 words)",multi:true},{field:"stat",label:"STAT / PULL QUOTE",multi:false},{field:"emoji",label:"EMOJI",multi:false}].map(({field,label,multi})=>(
                <div key={field} style={{ marginBottom:10 }}>
                  <div style={{ fontSize:8, color:C.muted, fontFamily:F.ui, fontWeight:700, letterSpacing:"0.1em", marginBottom:5 }}>{label}</div>
                  {multi?(
                    <textarea value={slides[active][field]||""} onChange={e=>onFieldEdit(active,field,e.target.value)} style={{ width:"100%", background:C.s3, border:`1px solid ${C.border}`, borderRadius:6, color:C.text, fontSize:11, fontFamily:F.body, padding:"8px 10px", resize:"vertical", outline:"none", lineHeight:1.65, minHeight:58 }} onFocus={e=>(e.target.style.borderColor=C.borderFocus)} onBlur={e=>(e.target.style.borderColor=C.border)}/>
                  ):(
                    <input value={slides[active][field]||""} onChange={e=>onFieldEdit(active,field,e.target.value)} style={{ width:"100%", background:C.s3, border:`1px solid ${C.border}`, borderRadius:6, color:C.text, fontSize:11, fontFamily:F.body, padding:"7px 10px", outline:"none" }} onFocus={e=>(e.target.style.borderColor=C.borderFocus)} onBlur={e=>(e.target.style.borderColor=C.border)}/>
                  )}
                </div>
              ))}
            </div>}
          </>)}

          {/* Caption view */}
          {view==="caption"&&<div style={{ width:"100%", maxWidth:490, animation:"fadeIn 0.2s ease" }}>
            {caption?(<>
              <div style={{ background:C.s2, border:`1px solid ${C.border}`, borderRadius:12, padding:"20px 22px", marginBottom:10 }}>
                <div style={{ fontSize:8.5, fontFamily:F.ui, fontWeight:700, color:C.muted, letterSpacing:"0.12em", marginBottom:12 }}>INSTAGRAM CAPTION</div>
                <p style={{ fontSize:13.5, lineHeight:1.82, color:C.text, fontFamily:F.body, margin:0 }}>{caption}</p>
              </div>
              <div style={{ background:C.s2, border:`1px solid ${C.border}`, borderRadius:12, padding:"20px 22px", marginBottom:10 }}>
                <div style={{ fontSize:8.5, fontFamily:F.ui, fontWeight:700, color:C.muted, letterSpacing:"0.12em", marginBottom:11 }}>HASHTAGS</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>{tags.map(t=><span key={t} style={{ background:C.s3, border:`1px solid ${C.border}`, borderRadius:4, padding:"3px 9px", fontSize:11, color:C.green, fontFamily:F.ui, fontWeight:700 }}>#{t}</span>)}</div>
              </div>
              {(voiceNote||compAngle||longevity)&&<div style={{ background:C.s2, border:`1px solid ${C.border}`, borderRadius:12, padding:"20px 22px", marginBottom:10 }}>
                <div style={{ fontSize:8.5, fontFamily:F.ui, fontWeight:700, color:C.muted, letterSpacing:"0.12em", marginBottom:14 }}>CONTENT INTELLIGENCE</div>
                {longevity&&<div style={{ marginBottom:11 }}><div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:4 }}><div style={{ width:6,height:6,borderRadius:"50%",background:LC[longevity]||C.green }}/><span style={{ fontSize:9.5,color:LC[longevity]||C.green,fontFamily:F.ui,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em" }}>{longevity}</span></div>{longReason&&<div style={{ fontSize:11,color:C.textMid,fontFamily:F.body,lineHeight:1.68,paddingLeft:13 }}>{longReason}</div>}</div>}
                {voiceNote&&<div style={{ marginBottom:11 }}><div style={{ fontSize:8.5,color:C.muted,fontFamily:F.ui,fontWeight:700,letterSpacing:"0.08em",marginBottom:4 }}>BRAND VOICE</div><div style={{ fontSize:11,color:C.textMid,fontFamily:F.body,lineHeight:1.68 }}>{voiceNote}</div></div>}
                {compAngle&&<div><div style={{ fontSize:8.5,color:C.muted,fontFamily:F.ui,fontWeight:700,letterSpacing:"0.08em",marginBottom:4 }}>COMPETITIVE DISTINCTION</div><div style={{ fontSize:11,color:C.textMid,fontFamily:F.body,lineHeight:1.68 }}>{compAngle}</div></div>}
              </div>}
              <button onClick={copyCaption} style={{ width:"100%", padding:"11px", background:copied?C.green:C.s2, color:copied?"#000":C.text, border:`1px solid ${copied?C.green:C.border}`, borderRadius:9, fontSize:10.5, fontFamily:F.ui, fontWeight:800, cursor:"pointer", transition:"all 0.2s", letterSpacing:"0.06em" }}>{copied?"COPIED TO CLIPBOARD":"COPY CAPTION + HASHTAGS"}</button>
            </>):<div style={{ textAlign:"center", color:C.muted, marginTop:90 }}><div style={{ fontSize:12,fontFamily:F.ui,fontWeight:700,marginBottom:5,color:C.textMid }}>No caption yet</div><div style={{ fontSize:10 }}>Generate a carousel first</div></div>}
          </div>}

          {/* Calendar view */}
          {view==="calendar"&&<CalendarPanel scheduled={scheduled} onSchedule={scheduleCarousel} onLoad={loadScheduled} hasCarousel={hasSlides}/>}
        </div>

        {/* RIGHT PANEL */}
        <div style={{ width:258, flexShrink:0, borderLeft:`1px solid ${C.border}`, background:C.s1, display:"flex", flexDirection:"column" }}>
          <div style={{ display:"flex", borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
            <button style={rTab("metrics")}   onClick={()=>setRT("metrics")}>METRICS</button>
            <button style={rTab("narrative")} onClick={()=>setRT("narrative")}>ARC</button>
            <button style={rTab("headlines")} onClick={()=>setRT("headlines")}>HEADS</button>
            <button style={rTab("export")}    onClick={()=>setRT("export")}>EXPORT</button>
          </div>
          <div style={{ flex:1, overflowY:"auto", padding:"16px 14px" }}>

            {rightTab==="metrics"&&<div style={{ animation:"fadeIn 0.18s ease" }}>
              {score!==null?(<>
                <div style={{ display:"flex", justifyContent:"center", marginBottom:16 }}><ScoreRing score={score}/></div>
                {breakdown&&<><div style={{ fontSize:8.5,color:C.muted,fontFamily:F.ui,fontWeight:700,letterSpacing:"0.1em",marginBottom:12 }}>ENGAGEMENT BREAKDOWN</div>{Object.entries(breakdown).map(([k,v])=>{ const labels={hook_strength:"Hook",content_depth:"Depth",visual_flow:"Flow",cta_clarity:"CTA",brand_voice:"Brand Voice",emotional_resonance:"Emotion"}; const col=v>=8?C.green:v>=6?C.warn:C.danger; return <MiniBar key={k} label={labels[k]||k} value={v} col={col}/>;})}</>}
                {tip&&<div style={{ marginTop:12, background:C.orangeDim, border:"1px solid rgba(255,85,0,0.2)", borderRadius:7, padding:"9px 11px" }}><div style={{ fontSize:8,fontFamily:F.ui,fontWeight:800,color:"#FF7A40",letterSpacing:"0.08em",marginBottom:4 }}>IMPROVEMENT TIP</div><div style={{ fontSize:10.5,color:"#FF9965",fontFamily:F.body,lineHeight:1.7 }}>{tip}</div></div>}
                {psych&&<div style={{ marginTop:16,paddingTop:14,borderTop:`1px solid ${C.border}` }}><div style={{ fontSize:8.5,color:C.muted,fontFamily:F.ui,fontWeight:700,letterSpacing:"0.1em",marginBottom:12 }}>PSYCHOLOGICAL TRIGGERS</div>{[{key:"curiosity_gap",label:"Curiosity Gap",col:C.violet},{key:"social_proof",label:"Social Proof",col:C.green},{key:"authority_signal",label:"Authority Signal",col:C.warn},{key:"aspiration_pull",label:"Aspiration Pull",col:C.orange},{key:"pain_acknowledgment",label:"Pain Recognition",col:C.rose}].map(({key,label,col})=><MiniBar key={key} label={label} value={psych[key]??0} col={col}/>)}</div>}
                {curve&&<div style={{ marginTop:16,paddingTop:14,borderTop:`1px solid ${C.border}` }}><RetentionBars curve={curve}/><div style={{ marginTop:9,fontSize:9.5,color:C.muted,fontFamily:F.body,lineHeight:1.65 }}>Estimated percentage of initial viewers who reach each slide.</div></div>}
                <div style={{ marginTop:16,paddingTop:14,borderTop:`1px solid ${C.border}` }}>
                  <div style={{ fontSize:8.5,color:C.muted,fontFamily:F.ui,fontWeight:700,letterSpacing:"0.1em",marginBottom:10 }}>SLIDE OUTLINE</div>
                  {slides.map((sl,i)=>(
                    <button key={i} onClick={()=>{ setActive(i); setView("studio"); setAbMode(false); }} style={{ display:"flex", alignItems:"center", gap:7, width:"100%", background:i===active&&view==="studio"?C.s4:"transparent", border:"none", cursor:"pointer", borderRadius:6, padding:"5px 7px", marginBottom:2, textAlign:"left", transition:"background 0.15s" }}
                      onMouseEnter={e=>{if(!(i===active&&view==="studio"))e.currentTarget.style.background=C.s4;}}
                      onMouseLeave={e=>{if(!(i===active&&view==="studio"))e.currentTarget.style.background="transparent";}}
                    ><span style={{ fontSize:14 }}>{sl.emoji}</span><div style={{ flex:1,overflow:"hidden" }}><div style={{ fontSize:9.5,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{sl.headline}</div><div style={{ fontSize:7.5,color:C.muted,fontFamily:F.ui,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",marginTop:1 }}>{sl.type}</div></div></button>
                  ))}
                </div>
              </>):<div style={{ textAlign:"center",color:C.muted,marginTop:44,animation:"fadeIn 0.3s ease" }}><div style={{ width:48,height:48,borderRadius:"50%",border:`2px solid ${C.border}`,margin:"0 auto 16px",opacity:0.3 }}/><div style={{ fontSize:12,fontFamily:F.ui,fontWeight:700,color:C.textMid,marginBottom:7 }}>Performance Analysis</div><div style={{ fontSize:10,lineHeight:1.85 }}>Engagement score, psychological triggers, swipe retention, and brand voice appear after generation</div></div>}
            </div>}

            {rightTab==="narrative"&&<div style={{ animation:"fadeIn 0.18s ease" }}>
              {arc?(<>
                <div style={{ fontSize:8.5,color:C.muted,fontFamily:F.ui,fontWeight:700,letterSpacing:"0.1em",marginBottom:11 }}>EMOTIONAL ARC</div>
                <NarrativeArcChart arc={arc}/>
                <div style={{ marginTop:10 }}>{arc.map((a,i)=>(
                  <div key={i} style={{ display:"flex",alignItems:"center",gap:7,padding:"5px 0",borderBottom:`1px solid ${C.border}` }}>
                    <span style={{ fontSize:7.5,color:C.muted,fontFamily:F.mono,minWidth:14 }}>{String(i+1).padStart(2,"0")}</span>
                    <span style={{ fontSize:9.5,color:C.text,fontFamily:F.body,flex:1 }}>{a.label}</span>
                    <span style={{ fontSize:7.5,color:C.violet,fontFamily:F.ui,fontWeight:700 }}>{a.emotion}</span>
                    <span style={{ fontSize:8,color:C.muted,fontFamily:F.mono,minWidth:24,textAlign:"right" }}>{a.intensity}/10</span>
                  </div>
                ))}</div>
                {longevity&&<div style={{ marginTop:16,paddingTop:14,borderTop:`1px solid ${C.border}` }}><div style={{ fontSize:8.5,color:C.muted,fontFamily:F.ui,fontWeight:700,letterSpacing:"0.1em",marginBottom:9 }}>CONTENT LONGEVITY</div><div style={{ display:"flex",alignItems:"center",gap:7,marginBottom:6 }}><div style={{ width:7,height:7,borderRadius:"50%",background:LC[longevity]||C.green }}/><span style={{ fontSize:11,color:LC[longevity]||C.green,fontFamily:F.ui,fontWeight:700,textTransform:"capitalize" }}>{longevity}</span></div>{longReason&&<div style={{ fontSize:10.5,color:C.textMid,fontFamily:F.body,lineHeight:1.7 }}>{longReason}</div>}</div>}
                {voiceNote&&<div style={{ marginTop:14,paddingTop:12,borderTop:`1px solid ${C.border}` }}><div style={{ fontSize:8.5,color:C.muted,fontFamily:F.ui,fontWeight:700,letterSpacing:"0.1em",marginBottom:7 }}>BRAND VOICE</div><div style={{ fontSize:10.5,color:C.textMid,fontFamily:F.body,lineHeight:1.72 }}>{voiceNote}</div></div>}
                {compAngle&&<div style={{ marginTop:14,paddingTop:12,borderTop:`1px solid ${C.border}` }}><div style={{ fontSize:8.5,color:C.muted,fontFamily:F.ui,fontWeight:700,letterSpacing:"0.1em",marginBottom:7 }}>COMPETITIVE EDGE</div><div style={{ fontSize:10.5,color:C.textMid,fontFamily:F.body,lineHeight:1.72 }}>{compAngle}</div></div>}
              </>):<div style={{ textAlign:"center",color:C.muted,marginTop:44 }}><div style={{ fontSize:12,fontFamily:F.ui,fontWeight:700,color:C.textMid,marginBottom:7 }}>Narrative Intelligence</div><div style={{ fontSize:10,lineHeight:1.85 }}>Emotional arc, intensity mapping, longevity analysis, and brand voice appear after generation</div></div>}
            </div>}

            {rightTab==="headlines"&&<HeadlinesPanel slides={slides} active={active} setActive={setActive} alts={headlineAlts} loadingAlt={loadingAlt} onGenerate={generateAlts} onSwap={swapHeadline}/>}
            {rightTab==="export"&&<ExportPanel slides={slides} caption={caption} tags={tags} brief={brief} score={score} format={format}/>}
          </div>
        </div>
      </div>
    </div>
  );
}
