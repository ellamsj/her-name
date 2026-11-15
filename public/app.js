(() => {
  "use strict";

  const CONFIG = { POLL_MS: 20000 };

  const $ = (id) => document.getElementById(id);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const isWall = /^\/wall\/?$/.test(location.pathname) || new URLSearchParams(location.search).has("wall");
  const STORE_KEY = "her-name:submitted";
  const state = { responses: [], mine: null, own: false };

  /* ── helpers ─────────────────────────────────────────── */
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; } },
    set(v) { try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID()
    : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12));
  const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
  const CJK = /[぀-ヿ㐀-鿿豈-﫿]/;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) { // mulberry32
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, reduced.matches ? 0 : ms));
  function setPhase(p) {
    for (const c of ["intro", "ask", "enter", "results"]) document.body.classList.toggle("phase-" + c, c === p);
    stage.clearing(p === "results");
  }
  function show(id) {
    for (const s of ["s1", "s2", "s3"]) $(s).hidden = s !== id;
    document.body.classList.toggle("is-asking", id !== "s3");
    document.body.classList.toggle("is-results", id === "s3");
    $("stepLabel").textContent = id === "s1" ? "Q.01 / 02" : id === "s2" ? "Q.02 / 02" : "Responses";
    window.scrollTo(0, 0);
    stage.refit();
    requestAnimationFrame(() => stage.relayout());
  }
  const focusHeading = (el) => el.focus({ preventScroll: true });

  function tick() { $("clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  tick(); setInterval(tick, 30000);

  /* ════════════════════════════════════════════════════════
     The flower: a carnation, shown as a halftone of cream dots on
     a fixed grid. The picture moves underneath the grid — it zooms,
     turns, breathes and opens — so each dot only grows, shrinks or
     appears in place. Every answer is set as a word inside the flower,
     replacing the dots it covers; as answers accumulate, more of the
     flower turns into type.
     ════════════════════════════════════════════════════════ */
  const stage = (() => {
    const FAM = '"Cormorant Garamond", "Noto Serif KR", Georgia, serif';
    const FAM_KO = '"Noto Serif KR", "Cormorant Garamond", serif';
    const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
    const CREAM = [244, 236, 212], WARM = [255, 168, 118], ACC = [255, 150, 112];
    const TSC = 0.6, TW = 360, TH = 600;  // texture: design box 600 × 1000 at 0.6 px per unit
    const OX = 300, OY = 270;             // the centre of the bloom, in design units
    const K = 16, M = TSC;                // stages of opening
    const ARRIVE_MS = 7200, LENS = 100;
    const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

    const el = $("stage"), cv = $("canvas"), ctx = cv.getContext("2d");
    const meas = document.createElement("canvas").getContext("2d");

    let W = 0, H = 0, dpr = 1;
    let stages = null, building = null;
    let g = 5, cols = 0, rows = 0, prevT = null, heat = null, spark = null;
    let mask = null, mcols = 0, mrows = 0;
    const MC = 4;

    let cur = null, from = null, to = null, tStart = 0, tDur = 0, mode = "none";
    const words = new Map();
    let order = [], S = 10, tS = 10;
    let pointer = null, tap = null, highlight = false, dimAmt = 0, pendingOrigin = null;
    let ripples = [], clearAmt = 0, clearTarget = 0, nextAmbient = 0;
    let running = false, last = 0, arriveEnd = 0, trail = 0;

    const lerp = (a, b, t) => a + (b - a) * t;
    const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`;
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

    /* ── the carnation, painted in greys (darker = more dots) in a 600 × 1000 design box ── */
    const grey = (t) => { const v = Math.round(255 * (1 - clamp(t, 0, 1))); return `rgb(${v},${v},${v})`; };
    function lin(c, x0, y0, x1, y1, stops) {
      const gr = c.createLinearGradient(x0, y0, x1, y1);
      for (const [o, t] of stops) gr.addColorStop(o, grey(t));
      return gr;
    }
    function drawCarnation(c, k, b = 1) {
      const r = rng(20240512);
      c.lineJoin = "round"; c.lineCap = "round";

      // stem
      c.beginPath();
      c.moveTo(287, 440); c.bezierCurveTo(294, 640, 264, 820, 276, 1000);
      c.lineTo(301, 1000); c.bezierCurveTo(290, 820, 320, 640, 314, 440); c.closePath();
      c.fillStyle = lin(c, 272, 0, 316, 0, [[0, 0.95], [0.3, 0.4], [0.55, 0.55], [1, 0.95]]);
      c.fill();
      for (const y of [655, 835]) { c.beginPath(); c.ellipse(292 - (y - 655) * 0.04, y, 13, 9, 0, 0, Math.PI * 2); c.fillStyle = grey(0.8); c.fill(); }

      // a side branch carrying a half-open bud
      c.beginPath(); c.moveTo(300, 660); c.bezierCurveTo(360, 620, 420, 560, 470, 470);
      c.strokeStyle = grey(0.85); c.lineWidth = 11; c.stroke();
      c.save();
      c.shadowColor = "rgba(0,0,0,0.6)"; c.shadowBlur = 8 * k * M; c.shadowOffsetY = 5 * k * M;
      for (const deg of [10, 46, 28]) petal(c, r, 478, 462, deg, 82 + r() * 14, 46, 0.95);
      c.restore();
      c.beginPath(); c.moveTo(452, 470); c.lineTo(462, 440); c.lineTo(474, 462); c.lineTo(490, 432); c.lineTo(496, 466);
      c.bezierCurveTo(494, 492, 480, 506, 468, 508); c.bezierCurveTo(456, 500, 450, 488, 452, 470); c.closePath();
      c.fillStyle = lin(c, 452, 0, 496, 0, [[0, 0.9], [0.4, 0.45], [1, 0.95]]); c.fill();

      // narrow, arching leaves in pairs
      const leaf = (x0, y0, cx, cy, x1, y1, w) => {
        const nx = -(cy - y0), ny = cx - x0, nl = Math.hypot(nx, ny);
        const ox = (nx / nl) * w, oy = (ny / nl) * w;
        c.beginPath(); c.moveTo(x0 + ox * 0.3, y0 + oy * 0.3);
        c.quadraticCurveTo(cx + ox, cy + oy, x1, y1);
        c.quadraticCurveTo(cx - ox, cy - oy, x0 - ox * 0.3, y0 - oy * 0.3); c.closePath();
        c.fillStyle = lin(c, x0, y0, x1, y1, [[0, 0.95], [0.35, 0.6], [0.8, 0.38], [1, 0.55]]);
        c.fill();
        c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(cx, cy, x1, y1);
        c.strokeStyle = grey(0.12); c.lineWidth = 3; c.stroke();
      };
      leaf(288, 655, 200, 640, 112, 540, 34);
      leaf(296, 655, 380, 630, 478, 590, 31);
      leaf(282, 835, 215, 800, 168, 700, 26);
      leaf(290, 835, 360, 820, 438, 760, 24);

      // petals, back layers first; each casts a soft shadow onto those behind it
      c.shadowColor = "rgba(0,0,0,0.85)";
      c.shadowBlur = 12 * k * M; c.shadowOffsetY = 10 * k * M;
      const layers = [
        { n: 13, spread: 80, len: 214, w: 104, by: 328, t: 1.0 },
        { n: 11, spread: 72, len: 204, w: 106, by: 334, t: 0.96 },
        { n: 10, spread: 62, len: 188, w: 104, by: 341, t: 0.9 },
        { n: 8, spread: 50, len: 160, w: 98, by: 349, t: 0.84 },
        { n: 7, spread: 40, len: 130, w: 90, by: 357, t: 0.78 },
        { n: 5, spread: 26, len: 100, w: 82, by: 365, t: 0.7 },
        { n: 3, spread: 12, len: 72, w: 70, by: 372, t: 0.62 },
      ];
      layers.forEach((L, li) => {
        // inner petals open first; the outer layers follow and spread last
        const lag = 0.22 * (1 - li / (layers.length - 1));
        const lb = clamp((b - lag) / (1 - lag), 0, 1), e = lb * lb * (3 - 2 * lb);
        const angles = [];
        for (let i = 0; i < L.n; i++) angles.push(-L.spread + (2 * L.spread * i) / (L.n - 1) + (r() - 0.5) * 9);
        angles.sort((a, z) => Math.abs(z) - Math.abs(a));
        for (const deg of angles) {
          const x = 300 + (r() - 0.5) * 16, len = L.len * (0.88 + r() * 0.2), w = L.w * (0.85 + r() * 0.3);
          petal(c, r, x, L.by + (1 - e) * 26, deg * (0.13 + 0.87 * e), len * (0.4 + 0.6 * e), w * (0.48 + 0.52 * e), L.t);
        }
      });
      c.shadowColor = "transparent"; c.shadowBlur = 0; c.shadowOffsetY = 0;

      // calyx with sepal tips, in front of the petal bases
      c.beginPath();
      c.moveTo(246, 352); c.lineTo(262, 312); c.lineTo(276, 356); c.lineTo(300, 300); c.lineTo(324, 356);
      c.lineTo(338, 312); c.lineTo(354, 352);
      c.bezierCurveTo(350, 410, 330, 440, 316, 470); c.lineTo(286, 470); c.bezierCurveTo(270, 440, 250, 410, 246, 352); c.closePath();
      c.fillStyle = lin(c, 246, 0, 354, 0, [[0, 0.95], [0.28, 0.45], [0.5, 0.55], [0.8, 0.8], [1, 0.97]]);
      c.fill();
      for (const x of [272, 300, 328]) {
        c.beginPath(); c.moveTo(x, 362); c.quadraticCurveTo(x + (300 - x) * 0.2, 420, 300 + (x - 300) * 0.3, 466);
        c.strokeStyle = "rgba(0,0,0,0.35)"; c.lineWidth = 2; c.stroke();
      }
    }
    // one fringed petal: a wedge from the base, flaring to a serrated, ruffled edge
    function petal(c, r, bx, by, deg, len, w, t) {
      const a = (deg * Math.PI) / 180, squash = 0.78;
      const P = (u, v) => {
        const x = v * Math.cos(a) + u * Math.sin(a), y = v * Math.sin(a) - u * Math.cos(a);
        return [bx + x, by + y * (deg > 95 || deg < -95 ? 1 : squash)];
      };
      c.beginPath();
      c.moveTo(...P(0, -7));
      const [q1x, q1y] = P(len * 0.5, -w * 0.32), [e1x, e1y] = P(len * 0.88, -w / 2);
      c.quadraticCurveTo(q1x, q1y, e1x, e1y);
      const teeth = 13 + Math.floor(r() * 8);
      for (let i = 1; i <= teeth * 2; i++) {
        const v = -w / 2 + (w * i) / (teeth * 2);
        const arc = len * (0.88 + 0.12 * Math.cos((v / w) * Math.PI));
        const depth = i % 2 ? len * (r() < 0.18 ? 0.16 + r() * 0.08 : 0.03 + r() * 0.08) : 0;
        c.lineTo(...P(arc + depth, v + (r() - 0.5) * 4));
      }
      const [q2x, q2y] = P(len * 0.5, w * 0.32), [e2x, e2y] = P(0, 7);
      c.quadraticCurveTo(q2x, q2y, e2x, e2y);
      c.closePath();
      const [gx0, gy0] = P(0, 0), [gx1, gy1] = P(len, 0);
      c.fillStyle = lin(c, gx0, gy0, gx1, gy1, [[0, 1 * t], [0.3, 0.8 * t], [0.65, 0.42 * t], [0.86, 0.2 * t], [1, 0.62 * t]]);
      c.fill();
      c.save(); c.clip();
      c.shadowColor = "transparent";
      c.strokeStyle = "rgba(0,0,0,0.55)"; c.lineWidth = 11; c.stroke();
      c.strokeStyle = "rgba(0,0,0,0.38)"; c.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        const v = (r() - 0.5) * w * 0.7;
        c.beginPath(); c.moveTo(...P(len * 0.15, v * 0.2)); c.quadraticCurveTo(...P(len * 0.6, v * 0.75), ...P(len * 0.95, v));
        c.stroke();
      }
      c.restore();
    }
    // paint every stage of opening once, in the background
    function prepare() {
      if (stages) return Promise.resolve();
      if (!building) building = (async () => {
        const tc = document.createElement("canvas"); tc.width = TW; tc.height = TH;
        const c = tc.getContext("2d", { willReadFrequently: true });
        const out = [];
        for (let j = 0; j < K; j++) {
          c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = "#fff"; c.fillRect(0, 0, TW, TH);
          c.setTransform(TSC, 0, 0, TSC, 0, 0);
          drawCarnation(c, 1, j / (K - 1));
          const d = c.getImageData(0, 0, TW, TH).data, u = new Uint8Array(TW * TH);
          for (let i = 0; i < u.length; i++) u[i] = 255 - d[i * 4];
          out.push(u);
          if (j % 2) await new Promise((res) => setTimeout(res, 0));
        }
        stages = out;
      })();
      return building;
    }

    /* ── sizing: a fixed grid of possible dots over the whole screen ── */
    function resize() {
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) { W = H = 0; return false; }
      if (Math.abs(r.width - W) < 1 && Math.abs(r.height - H) < 1) return false;
      W = r.width; H = r.height; dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      g = W < 700 ? 4.8 : 5.8;
      cols = Math.ceil(W / g); rows = Math.ceil(H / g);
      const n = cols * rows, r2 = rng(9);
      prevT = new Float32Array(n); heat = new Float32Array(n); spark = new Float32Array(n);
      for (let i = 0; i < n; i++) spark[i] = r2() < 0.012 ? r2() * 6.28 : -1; // a few marks twinkle as crosses
      mcols = Math.ceil(W / MC); mrows = Math.ceil(H / MC); mask = new Float32Array(mcols * mrows);
      if (mode !== "none") { to = target(); from = { ...to }; tDur = 0; cur = { ...to }; }
      return true;
    }

    // the flower stands in the middle of the page, its stem running out of the bottom
    function target() {
      const phone = W < 700;
      const s = phone ? Math.min(W / 390, H / 700) : Math.min(H / 520, W / 600);
      return { cx: W * 0.5, cy: H * (phone ? 0.42 : 0.45), s, rot: 0, b: 1 };
    }
    function arrive(dur) {
      const t = target();
      from = { ...t, s: t.s * 0.97, b: 0 }; // already there, a closed bud; it only opens
      to = t; mode = "results"; tStart = performance.now(); tDur = reduced.matches ? 0 : dur;
      cur = { ...from };
      arriveEnd = tStart + tDur;
      kick();
    }

    // the small texts around the flower keep the dots and words away
    function textRects() {
      const out = [];
      for (const n of document.querySelectorAll(".note")) {
        const r = n.getBoundingClientRect();
        if (r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < H) out.push({ x0: r.left - 18, y0: r.top - 14, x1: r.right + 18, y1: r.bottom + 14 });
      }
      return out;
    }

    /* ── ripples ── */
    function addRipple(x, y, t0, amp) { if (!reduced.matches) { ripples.push({ x, y, t0, amp }); if (ripples.length > 16) ripples.shift(); kick(); } }
    let WX = 0, WY = 0;
    function wave(x, y, now) {
      WX = 0; WY = 0;
      for (const rp of ripples) {
        const age = (now - rp.t0) / 1000;
        if (age < 0 || age > 2) continue;
        const dx = x - rp.x, dy = y - rp.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        const band = (d - age * 260) / 24;
        if (band > -3 && band < 3) { const f = Math.exp(-band * band) * rp.amp * (1 - age / 2); WX += (dx / d) * f; WY += (dy / d) * f; }
      }
    }

    /* ── reading the flower: darkness at a screen point, for the final pose ── */
    function toneAt(P, A, Bs, fm, x, y) {
      const dx = x - P.cx, dy = y - P.cy, cs = Math.cos(-P.rot), sn = Math.sin(-P.rot);
      const ux = (dx * cs - dy * sn) / P.s + OX, uy = (dx * sn + dy * cs) / P.s + OY;
      const u = ux * TSC, v = uy * TSC;
      if (u < 0 || v < 0 || u >= TW - 1 || v >= TH - 1) return 0;
      const ti = (v | 0) * TW + (u | 0);
      return (A[ti] + (Bs[ti] - A[ti]) * fm) / 255;
    }
    const finalT = (x, y) => toneAt(target(), stages[K - 1], stages[K - 1], 0, x, y);

    /* rows of typesetting space inside the flower, at font size s */
    const INK_MIN = 0.3;
    function segments(s) {
      const lh = s * 1.3, off = lh * 0.28, segs = [], blocks = textRects();
      for (let y = 44 + lh / 2; y < H - lh / 2; y += lh) {
        let start = -1;
        const blocked = (x) => blocks.some((c) => x > c.x0 && x < c.x1 && y + off > c.y0 && y - off < c.y1);
        for (let x = 10; x <= W - 8; x += 2) {
          const ok = x <= W - 12 && finalT(x, y) > INK_MIN && finalT(x, y - off) > INK_MIN && finalT(x, y + off) > INK_MIN && !blocked(x);
          if (ok && start < 0) start = x;
          else if (!ok && start >= 0) { if (x - start > s * 1.4) segs.push({ y, x0: start, x1: x }); start = -1; }
        }
      }
      return segs;
    }
    const widthAt = (w, s) => (w.w100 * s) / 100;
    function fit(maxS) {
      const n = order.length;
      const sum = order.reduce((a, w) => a + w.w100 * w.fac, 0) / 100;
      const need = (s) => s * sum + n * s * 0.6;
      const cap = (s) => segments(s).reduce((a, gg) => a + gg.x1 - gg.x0, 0);
      if (need(maxS) <= 0.7 * cap(maxS)) return maxS;
      let lo = 2.8, hi = maxS, best = 2.8;
      for (let i = 0; i < 11; i++) { const mid = (lo + hi) / 2; if (need(mid) <= 0.7 * cap(mid)) { best = mid; lo = mid; } else hi = mid; }
      return best;
    }
    // spread the words evenly through the flower, never splitting a word across a gap
    function place(s) {
      const segs = segments(s), gap = s * 0.6, n = order.length;
      const starts = []; let cap = 0;
      for (const gg of segs) { starts.push(cap); cap += gg.x1 - gg.x0; }
      const used = order.reduce((a, w) => a + widthAt(w, s * w.fac) + gap, 0);
      const slack = (Math.max(0, cap - used) / n) * 0.9;
      const out = new Map();
      let gi = 0, at = 0, ok = true;
      for (let i = 0; i < n; i++) {
        const w = order[i], ww = widthAt(w, s * w.fac);
        let pos = at + slack * (0.5 + 0.5 * rng(w.h ^ 0x9e37)());
        while (gi < segs.length && pos + ww > starts[gi] + (segs[gi].x1 - segs[gi].x0)) {
          gi++; if (gi < segs.length) pos = Math.max(pos, starts[gi]);
        }
        if (gi >= segs.length) { ok = false; break; }
        out.set(w.id, { x: segs[gi].x0 + pos - starts[gi], y: segs[gi].y });
        at = pos + ww + gap;
      }
      return { out, ok };
    }

    function layout() {
      if (!W || !stages || mode !== "results") return;
      const P = target(), n = order.length;
      const maxS = clamp(P.s * 4.2, 5, 7);
      let s = n ? fit(maxS) : maxS, slots = null;
      for (let k = 0; k < 10 && n; k++) { const p = place(s); slots = p.out; if (p.ok) break; s *= 0.94; }
      tS = s;

      const now = performance.now();
      const origin = pendingOrigin && words.get(pendingOrigin);
      const fresh = order.filter((w) => !w.placed);
      const firstPaint = fresh.length === order.length;
      if (firstPaint) S = s;
      for (const w of order) {
        const r = rng(w.h);
        let slot = slots && slots.get(w.id);
        if (!slot) { // over capacity: tuck it somewhere inside the flower
          for (let t = 0; t < 400; t++) { const x = r() * W, y = r() * H; if (finalT(x, y) > INK_MIN) { slot = { x: x - widthAt(w, s) / 2, y }; break; } }
          slot = slot || { x: P.cx, y: P.cy };
        }
        w.tx = slot.x; w.ty = slot.y;
        w.tone = clamp(finalT(slot.x + widthAt(w, s * w.fac) / 2, slot.y), 0.3, 1);
        if (!w.placed) { w.x = w.tx; w.y = w.ty; w.placed = true; }
      }
      // the type grows up the flower: from the stem, into the bloom
      fresh.sort((a, b) => b.ty - a.ty || a.tx - b.tx);
      const base = Math.max(0, arriveEnd - now) + 250;
      fresh.forEach((w, i) => {
        w.wait = reduced.matches ? 0 : now + (w === origin ? base + 600 + Math.min(3600, 55 * fresh.length) : firstPaint ? base + (i / Math.max(1, fresh.length)) * Math.min(3600, 55 * fresh.length) : 400);
        w.ripple = !reduced.matches && (w === origin || !firstPaint);
      });
      for (const w of fresh) if (w.ripple) { addRipple(w.tx + widthAt(w, s * w.fac) / 2, w.ty, w.wait + w.dur * 0.6, w === origin ? 10 : 5); w.ripple = false; }
      if (origin) pendingOrigin = null;
      if (highlight) applyHighlight(true);
      $("count").textContent = n === 1 ? "1 answer" : `${n} answers`;
      kick();
    }

    /* words */
    function makeWord(r, n) {
      const label = r.text || "I’m not sure";
      const cjk = HANGUL.test(label) || CJK.test(label);
      const unsure = r.category === "unsure" && !r.text;
      const w = {
        id: r.id, label, chars: [...label], n, cjk, unsure, first: r.category === "first", h: hash(r.id),
        italic: !cjk && unsure, fac: cjk ? 0.8 : 1, fam: cjk ? FAM_KO : FAM,
        placed: false, x: 0, y: 0, tx: 0, ty: 0, a: 0, ta: 1, m: 0, tm: 0, wait: Infinity, hlAt: 0, tone: 1,
      };
      w.dur = 420 + w.chars.length * 55;
      measure(w);
      return w;
    }
    function measure(w) {
      meas.font = `${w.italic ? "italic " : ""}${w.cjk ? 300 : 500} 100px ${w.fam}`;
      w.w100 = meas.measureText(w.label).width;
    }
    const fontFor = (w, size) => `${w.italic ? "italic " : ""}${w.cjk ? 300 : 500} ${size.toFixed(2)}px ${w.fam}`;

    async function loadFonts(responses) {
      if (!document.fonts || !document.fonts.load) return;
      const text = responses.map((r) => r.text).join("") + "I’m not sure 0123456789";
      try {
        await Promise.race([
          Promise.all([
            document.fonts.load('500 100px "Cormorant Garamond"', text),
            document.fonts.load('italic 500 100px "Cormorant Garamond"', text),
            document.fonts.load('300 100px "Noto Serif KR"', text),
            document.fonts.load('10px "IBM Plex Mono"', "ANSWER Nº 0123456789"),
          ]),
          new Promise((r) => setTimeout(r, 3000)),
        ]);
      } catch { /* fall back to system fonts */ }
    }

    async function update(responses, opts = {}) {
      await loadFonts(responses);
      await prepare();
      resize();
      if (opts.origin) pendingOrigin = opts.origin;
      const ids = new Set();
      responses.forEach((r, i) => { ids.add(r.id); if (!words.has(r.id)) words.set(r.id, makeWord(r, i + 1)); });
      for (const id of [...words.keys()]) if (!ids.has(id)) words.delete(id);
      order = [...words.values()].sort((a, b) => a.h - b.h); // shuffled, but stable
      if (opts.bloom) {
        for (const w of order) { w.placed = false; w.a = 0; w.wait = Infinity; }
        if (mode !== "results") arrive(ARRIVE_MS);
      }
      const ul = $("answerList"); ul.textContent = "";
      for (const r of responses) { const li = document.createElement("li"); li.textContent = r.text || "I’m not sure"; ul.append(li); }
      layout();
      const lastWait = order.reduce((m, w) => Math.max(m, w.wait + w.dur), performance.now());
      return Math.max(0, lastWait - performance.now()) + 500; // how long the entrance takes
    }

    /* her own name */
    function applyHighlight(on) {
      highlight = on;
      const now = performance.now();
      for (const w of order) {
        w.ta = on ? (w.first ? 1 : 0.16) : 1;
        w.tm = on && w.first ? 1 : 0;
        w.hlAt = reduced.matches ? now : Math.max(w.wait + w.dur, now + clamp(1 - w.ty / Math.max(1, H), 0, 1) * 600);
      }
      kick();
    }

    /* ── motion ── */
    function frame(fn) { // requestAnimationFrame, with a timer fallback where it is throttled
      let done = false;
      const id = requestAnimationFrame((t) => { if (!done) { done = true; fn(t); } });
      setTimeout(() => { if (!done) { done = true; cancelAnimationFrame(id); fn(performance.now()); } }, 34);
    }
    function kick() { if (!running && W) { running = true; last = performance.now(); frame(step); } }
    // arriving: a long, decelerating pull back from a close-up while the flower turns and opens
    function step(now) {
      const dt = Math.min(64, now - last || 16); last = now;
      const instant = reduced.matches;
      let moving = false;

      if (to) {
        const p = tDur ? clamp((now - tStart) / tDur, 0, 1) : 1;
        if (p < 1) moving = true;
        const tr = p < 1 && tDur ? 1 : 0;
        trail += (tr - trail) * (instant ? 1 : 1 - Math.exp(-dt / 600));
        const ez = 1 - Math.pow(1 - p, 2), er = ez, eb = 1 - Math.pow(1 - p, 2.1);
        cur = {
          cx: lerp(from.cx, to.cx, er), cy: lerp(from.cy, to.cy, er),
          s: from.s * Math.pow(to.s / from.s, ez), rot: lerp(from.rot, to.rot, er), b: lerp(from.b, to.b, eb),
        };
        if (!instant) { // then it breathes
          const tt = now / 1000;
          cur.rot += 0.012 * Math.sin(tt * 0.23);
          cur.s *= 1 + 0.012 * Math.sin(tt * 0.9);
          cur.b = clamp(cur.b - 0.045 * (0.5 + 0.5 * Math.sin(tt * 0.7)), 0, 1);
          cur.cx += 4 * Math.sin(tt * 0.31); cur.cy += 3 * Math.sin(tt * 0.27);
          moving = true;
        }
      }

      ripples = ripples.filter((rp) => now - rp.t0 < 2200);
      if (ripples.length) moving = true;
      if (mode === "results" && !instant && order.length && now > nextAmbient && now > arriveEnd + 4000) {
        const w = order[(Math.random() * order.length) | 0];
        if (nextAmbient) addRipple(w.tx + widthAt(w, S * w.fac) / 2, w.ty, now, 2 + Math.random() * 2);
        nextAmbient = now + 3000 + Math.random() * 3500;
      }
      const kc = instant ? 1 : 1 - Math.exp(-dt / 450);
      clearAmt += (clearTarget - clearAmt) * kc;
      if (Math.abs(clearTarget - clearAmt) > 0.003) moving = true; else clearAmt = clearTarget;
      const dTarget = highlight ? 1 : 0;
      dimAmt += (dTarget - dimAmt) * kc;
      if (Math.abs(dTarget - dimAmt) > 0.003) moving = true; else dimAmt = dTarget;
      S += (tS - S) * (instant ? 1 : 1 - Math.exp(-dt / 400));
      if (Math.abs(tS - S) > 0.01) moving = true;

      for (const w of order) {
        if (now < w.wait) { moving = true; continue; }
        const pr = instant ? 1 : clamp((now - w.wait) / w.dur, 0, 1);
        if (pr < 1) moving = true;
        const ka = instant ? 1 : 1 - Math.exp(-dt / 260);
        if (now >= w.hlAt) { w.m += (w.tm - w.m) * ka; if (Math.abs(w.tm - w.m) > 0.004) moving = true; }
        const ta = now >= w.hlAt ? w.ta : 1;
        w.a += (ta * Math.min(1, pr * 2.5) - w.a) * ka;
        if (Math.abs(ta - w.a) > 0.004) moving = true;
        const k = instant ? 1 : 1 - Math.exp(-dt / 500);
        w.x += (w.tx - w.x) * k; w.y += (w.ty - w.y) * k;
        if (Math.abs(w.tx - w.x) > 0.15 || Math.abs(w.ty - w.y) > 0.15) moving = true;
      }

      draw(now);
      if (document.hidden) { running = false; return; }
      if (moving || pointer || (tap && now < tap.until)) frame(step);
      else { running = false; if (tap) { tap = null; draw(now); } }
    }
    const smoothstep = (x) => x * x * (3 - 2 * x);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) kick(); });

    // the words sit in the flower's final pose; this carries them along with its breathing
    function delta(P0, C) {
      const k = C.s / P0.s, dr = C.rot - P0.rot;
      return { k, dr, cs: Math.cos(dr), sn: Math.sin(dr), P0, C };
    }

    /* words knock the dots out beneath them (in the words' own frame) */
    function buildMask() {
      mask.fill(0);
      for (const w of order) {
        if (w.a < 0.03) continue;
        const size = S * w.fac, ww = widthAt(w, size), v = Math.min(1, w.a);
        const c0 = Math.max(0, ((w.x - 2) / MC) | 0), c1 = Math.min(mcols - 1, ((w.x + ww + 2) / MC) | 0);
        const r0 = Math.max(0, ((w.y - size * 0.6) / MC) | 0), r1 = Math.min(mrows - 1, ((w.y + size * 0.6) / MC) | 0);
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const i = r * mcols + c; if (mask[i] < v) mask[i] = v; }
      }
    }

    const NS = 5; // dot sizes
    function drawDots(now, D) {
      const P = cur, inv = 1 / P.s;
      const cs = Math.cos(-P.rot), sn = Math.sin(-P.rot);
      // the part of the screen the flower can cover
      const corners = [[-OX, -OY], [600 - OX, -OY], [-OX, 1000 - OY], [600 - OX, 1000 - OY]].map(([x, y]) => {
        const c2 = Math.cos(P.rot), s2 = Math.sin(P.rot);
        return [P.cx + (x * c2 - y * s2) * P.s, P.cy + (x * s2 + y * c2) * P.s];
      });
      const gx0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0])) / g) - 1), gx1 = Math.min(cols - 1, Math.ceil(Math.max(...corners.map((c) => c[0])) / g) + 1);
      const gy0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1])) / g) - 1), gy1 = Math.min(rows - 1, Math.ceil(Math.max(...corners.map((c) => c[1])) / g) + 1);

      const f = P.b * (K - 1), f0 = Math.min(K - 1, f | 0), f1 = Math.min(K - 1, f0 + 1), fm = f - f0;
      const A = stages[f0], Bs = stages[f1];
      const rippling = ripples.length > 0, pt = !reduced.matches && pointer;
      const live = clearAmt > 0.01 ? textRects() : [];
      const hk = Math.exp(-16 / 220), tt = now / 1000;
      const paths = []; for (let i = 0; i < NS * 2; i++) paths.push(new Path2D());
      const crosses = new Path2D(), warmCross = new Path2D();
      const words = order.length && D;
      for (let r = gy0; r <= gy1; r++) {
        for (let c = gx0; c <= gx1; c++) {
          const i = r * cols + c;
          const x = (c + 0.5) * g, y = (r + 0.5) * g;
          let sx = x, sy = y;
          if (rippling) { wave(x, y, now); sx -= WX; sy -= WY; }
          if (pt) { // a loupe: the flower is magnified under the pointer
            const dx = x - pt.x, dy = y - pt.y, dd = dx * dx + dy * dy;
            if (dd < LENS * LENS) { const q = 0.45 + 0.55 * (dd / (LENS * LENS)); sx = pt.x + (sx - pt.x) * q; sy = pt.y + (sy - pt.y) * q; }
          }
          const dx = sx - P.cx, dy = sy - P.cy;
          const u = ((dx * cs - dy * sn) * inv + OX) * TSC, v = ((dx * sn + dy * cs) * inv + OY) * TSC;
          let t = 0;
          if (u >= 0 && v >= 0 && u < TW - 1 && v < TH - 1) {
            const ti = (v | 0) * TW + (u | 0);
            t = (A[ti] + (Bs[ti] - A[ti]) * fm) / 255;
          }
          if (t > 0.02) {
            if (words) { // where a word sits, the dots give way
              const ox = x - D.C.cx, oy = y - D.C.cy;
              const wx = D.P0.cx + (ox * D.cs + oy * D.sn) / D.k, wy = D.P0.cy + (-ox * D.sn + oy * D.cs) / D.k;
              const mc = (wx / MC) | 0, mr = (wy / MC) | 0;
              if (mc >= 0 && mr >= 0 && mc < mcols && mr < mrows) t *= 1 - mask[mr * mcols + mc];
            }
            for (const q of live) {
              const ex = Math.max(q.x0 - x, 0, x - q.x1), ey = Math.max(q.y0 - y, 0, y - q.y1);
              t *= 1 - clearAmt * (1 - Math.min(1, Math.sqrt(ex * ex + ey * ey) / 40));
            }
          }
          const d = t - prevT[i]; prevT[i] = t;
          let h = heat[i] * hk; if (d > 0.2 && trail > 0.02) h = Math.max(h, Math.min(1, (d - 0.12) * 2.4) * trail); heat[i] = h;
          // ordered dither: halftone texture in the lighter parts
          if (t < 0.06 + BAYER[(r & 3) * 4 + (c & 3)] * 0.42) continue;
          const warm = h > 0.25 ? 1 : 0;
          if (spark[i] >= 0 && t > 0.45 && Math.sin(tt * 1.7 + spark[i]) > 0.55) {
            const a = g * 0.55;
            (warm ? warmCross : crosses).rect(x - a, y - 0.5, a * 2, 1); (warm ? warmCross : crosses).rect(x - 0.5, y - a, 1, a * 2);
            continue;
          }
          const si = Math.min(NS - 1, (t * NS) | 0), sz = g * (0.22 + 0.13 * si);
          paths[si + warm * NS].rect(x - sz / 2, y - sz / 2, sz, sz);
        }
      }
      const dim = 1 - 0.6 * dimAmt;
      for (let si = 0; si < NS; si++) {
        ctx.fillStyle = rgba(CREAM, (0.55 + 0.1 * si) * dim); ctx.fill(paths[si]);
        ctx.fillStyle = rgba(WARM, 0.95 * dim); ctx.fill(paths[si + NS]);
      }
      ctx.fillStyle = rgba(CREAM, dim); ctx.fill(crosses);
      ctx.fillStyle = rgba(WARM, dim); ctx.fill(warmCross);
    }

    const GLYPHS = "+×·:/–<>=";
    function draw(now) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!stages || !cur || !W) return;
      const D = mode === "results" ? delta(target(), cur) : null;
      buildMask();
      drawDots(now, D);

      // the words: set in place, carried by the flower's breathing; each arrives as a scramble that resolves
      if (D && order.length) {
        ctx.save();
        ctx.translate(D.C.cx, D.C.cy); ctx.rotate(D.dr); ctx.scale(D.k, D.k); ctx.translate(-D.P0.cx, -D.P0.cy);
        ctx.textBaseline = "middle"; ctx.textAlign = "left";
        const step = Math.floor(now / 70);
        for (const w of order) {
          if (w.a < 0.01) continue;
          let x = w.x, y = w.y;
          if (ripples.length) { wave(x, y, now); x += WX; y += WY; }
          ctx.font = fontFor(w, S * w.fac);
          const base = (0.62 + 0.38 * w.tone) * (w.unsure ? 0.75 : 1);
          ctx.fillStyle = rgba(mix(CREAM, ACC, w.m), w.a * (base + (1 - base) * w.m));
          const pr = clamp((now - w.wait) / w.dur, 0, 1);
          if (pr >= 1 || reduced.matches) ctx.fillText(w.label, x, y);
          else {
            const shown = Math.floor(pr * w.chars.length);
            let txt = w.chars.slice(0, shown).join("");
            const r = rng(w.h + step);
            for (let i = shown; i < w.chars.length; i++) txt += w.chars[i] === " " ? " " : GLYPHS[(r() * GLYPHS.length) | 0];
            ctx.fillText(txt, x, y);
          }
        }
        ctx.restore();
      }

      let near = null;
      if (tap && now < tap.until) near = words.get(tap.id);
      else if (pointer) near = nearest(pointer.x, pointer.y, 18, D);
      if (near && near.a > 0.3 && D) callout(near, `Answer Nº ${String(near.n).padStart(3, "0")}`, D);
    }

    // a word's place on screen right now
    function onScreen(w, D, x = w.x, y = w.y) {
      const ox = (x - D.P0.cx) * D.k, oy = (y - D.P0.cy) * D.k;
      return [D.C.cx + ox * D.cs - oy * D.sn, D.C.cy + ox * D.sn + oy * D.cs];
    }
    function nearest(x, y, within, D) {
      if (!D) return null;
      let best = null, bd = within;
      for (const w of order) {
        if (w.a < 0.3) continue;
        const ww = widthAt(w, S * w.fac) * D.k;
        const [sx, sy] = onScreen(w, D);
        const dx = Math.max(sx - x, 0, x - (sx + ww)), dy = Math.abs(sy - y);
        const d = Math.hypot(dx, dy);
        if (d < bd) { bd = d; best = w; }
      }
      return best;
    }

    function callout(w, title, D) {
      const size = S * w.fac * D.k, ww = widthAt(w, S * w.fac) * D.k;
      const [wx, wy] = onScreen(w, D);
      const big = clamp(W / 22, 20, 34);
      ctx.font = `400 9px ${MONO}`;
      const t1 = title.toUpperCase();
      const tw1 = ctx.measureText(t1).width + 1.1 * t1.length;
      ctx.font = fontFor(w, big * w.fac);
      const tw2 = ctx.measureText(w.label).width;
      const bw2 = Math.min(W - 24, Math.max(tw1, tw2) + 24), bh2 = big + 34;
      const leftSide = wx + ww / 2 < W / 2;
      const bx = clamp(leftSide ? wx - 12 : wx + ww + 12 - bw2, 12, W - 12 - bw2);
      const above = wy - bh2 - 34 > 50;
      const by = clamp(above ? wy - bh2 - 34 : wy + 34, 40, H - bh2 - 10);
      ctx.strokeStyle = rgba(CREAM, 0.85); ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(wx - 3) + 0.5, Math.round(wy - size * 0.62) + 0.5, Math.round(ww + 6), Math.round(size * 1.24));
      const ax = wx + ww / 2, ay = above ? wy - size * 0.62 : wy + size * 0.62;
      const ey = above ? by + bh2 : by;
      const ex = clamp(ax, bx + 10, bx + bw2 - 10);
      ctx.beginPath(); ctx.moveTo(ax + 0.5, ay); ctx.lineTo(ax + 0.5, (ay + ey) / 2); ctx.lineTo(ex + 0.5, (ay + ey) / 2); ctx.lineTo(ex + 0.5, ey); ctx.stroke();
      ctx.fillStyle = "rgba(14,20,12,0.78)"; ctx.fillRect(bx, by, bw2, bh2);
      ctx.strokeRect(Math.round(bx) + 0.5, Math.round(by) + 0.5, Math.round(bw2), Math.round(bh2));
      ctx.fillStyle = rgba(CREAM, 0.7); ctx.font = `400 9px ${MONO}`;
      if ("letterSpacing" in ctx) ctx.letterSpacing = "1px";
      ctx.fillText(t1, bx + 12, by + 13);
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      ctx.fillStyle = rgba(mix(CREAM, ACC, w.m), 1); ctx.font = fontFor(w, big * w.fac);
      ctx.fillText(w.label, bx + 12, by + 20 + big / 2 + 2, bw2 - 24);
    }

    /* pointer: a loupe follows the mouse; a tap ripples the dots and reads the nearest word */
    const local = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener("pointermove", (e) => {
      if (e.pointerType === "mouse" || e.buttons) { pointer = local(e); kick(); }
    });
    cv.addEventListener("pointerleave", () => { pointer = null; kick(); });
    const lift = (e) => { if (e.pointerType !== "mouse") { pointer = null; kick(); } };
    cv.addEventListener("pointerup", lift);
    cv.addEventListener("pointercancel", lift);
    cv.addEventListener("pointerdown", (e) => {
      const p = local(e);
      addRipple(p.x, p.y, performance.now(), 7);
      if (e.pointerType === "mouse") return;
      pointer = p;
      const w = nearest(p.x, p.y, 34, mode === "results" && cur ? delta(target(), cur) : null);
      tap = w ? { id: w.id, until: performance.now() + 3200 } : null;
      kick();
    });

    function refit() { if (resize()) layout(); kick(); }
    if (window.ResizeObserver) new ResizeObserver(() => refit()).observe(el);
    else window.addEventListener("resize", refit);
    if (document.fonts) document.fonts.addEventListener?.("loadingdone", () => { words.forEach(measure); if (W) layout(); });

    return {
      update, refit, prepare, highlight: applyHighlight,
      // the flower appears as a bud behind the fading question and starts to open
      begin: () => prepare().then(() => { resize(); if (W && mode !== "results") arrive(ARRIVE_MS); }),
      get open() { return mode === "results"; },
      relayout: () => { if (W) layout(); else refit(); },
      clearing: (on) => { clearTarget = on ? 1 : 0; kick(); },
    };
  })();

  /* ── 1. what do you call your mother? ─────────────────── */
  $("f1").addEventListener("submit", (e) => {
    e.preventDefault();
    const word = $("mom").value.replace(/\s+/g, " ").trim();
    if (!word) { $("q1err").textContent = "Type the word you use — any language is fine."; $("mom").focus(); return; }
    $("q1err").textContent = "";
    show("s2"); focusHeading($("q2"));
  });

  /* ── 2. what do other people call her? ────────────────── */
  const cid = uid();
  $("f2").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("others").value.replace(/\s+/g, " ").trim();
    const picked = $("f2").querySelector("input[name=category]:checked");
    const err = $("q2err");
    if (!picked) { err.textContent = "Choose the description that fits your answer best."; $("f2").querySelector("input[name=category]").focus(); return; }
    if (!text && picked.value !== "unsure") { err.textContent = "Type what people call her — or choose “I’m not sure.”"; $("others").focus(); return; }
    err.textContent = "";
    const btn = $("submitBtn");
    btn.disabled = true;
    try {
      const res = await fetch("/api/responses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cid, text, category: picked.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      state.mine = data.id;
      state.responses = data.responses;
      store.set({ id: data.id });
      openResults(true);
    } catch (ex) {
      err.textContent = (ex && ex.message && !/fetch|network/i.test(ex.message))
        ? ex.message : "Couldn’t reach the exhibition server. Check your connection and try again.";
    } finally { btn.disabled = false; }
  });

  /* ── 3. results ───────────────────────────────────────── */
  function renderResult() {
    const Y = state.responses.length;
    const X = state.responses.filter((r) => r.category === "first").length;
    if (!Y) { $("result").textContent = "No responses yet."; return; }
    const Z = Math.round((X / Y) * 100);
    const n = (v) => Object.assign(document.createElement("span"), { className: "num", textContent: v });
    $("result").textContent = "";
    $("result").append(n(X), " of ", n(Y), ` student${Y === 1 ? "" : "s"} said people usually call their mother by her first name or nickname (`, n(Z + "%"), ").");
  }

  // the questions dissolve; the flower arrives; the answers are set into it; then the small texts appear
  async function openResults(fromSubmit) {
    setPhase("enter");
    document.body.classList.add("has-flower");
    stage.begin();
    await sleep(1400);
    show("s3");
    if (!fromSubmit) await refresh();
    renderResult();
    const took = await stage.update(state.responses, { origin: fromSubmit ? state.mine : null, bloom: true });
    await sleep(Math.min(took, 15000));
    setPhase("results");
    focusHeading($("resultsTitle"));
  }

  async function refresh() {
    try {
      const res = await fetch("/api/responses", { cache: "no-store" });
      if (!res.ok) return false;
      const data = await res.json();
      const changed = data.responses.length !== state.responses.length ||
        data.responses.some((r, i) => !state.responses[i] || state.responses[i].id !== r.id);
      state.responses = data.responses;
      return changed;
    } catch { return false; }
  }

  setInterval(async () => {
    if (document.hidden) return;
    if (await refresh() && stage.open) { await stage.update(state.responses); renderResult(); }
  }, CONFIG.POLL_MS);

  $("toggle").addEventListener("click", () => {
    state.own = !state.own;
    stage.highlight(state.own);
    const btn = $("toggle");
    btn.setAttribute("aria-pressed", String(state.own));
    btn.textContent = state.own ? "Show all" : "Her own name";
    const n = state.responses.filter((r) => r.category === "first").length;
    $("toggleStatus").textContent = state.own
      ? `Highlighting ${n} first ${n === 1 ? "name or nickname" : "names or nicknames"}. Other answers are dimmed in place.`
      : "Showing all responses.";
  });

  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-goto=wall]");
    if (a) { e.preventDefault(); openResults(false); }
  });

  /* ── entry: a blank page and a question; the flower comes after ── */
  if (isWall) {
    document.body.classList.add("is-wall");
    openResults(false);
  } else {
    const prev = store.get();
    if (prev && prev.id) { state.mine = prev.id; $("returnLink").hidden = false; }
    show("s1");
    setPhase("ask");
    focusHeading($("q1"));
    refresh();
    setTimeout(() => stage.prepare(), 300); // paint the flower quietly while the questions are answered
  }
})();
