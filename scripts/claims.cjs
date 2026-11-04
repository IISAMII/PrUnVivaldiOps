// Worker claim times from stock drops between two FIO readings of a base.
// A reading window (a, b] is "positive" when the stock of materials only workers use fell by one day of use
// (a claim happened inside the window), "negative" when it did not move (no claim inside the window).
// A claim happens at the same time every day, so all windows are folded onto 24 hours and intersected.
const DAY = 864e5, MIN = 6e4;
const pure = b => { const used = new Set(); (b.lines || []).forEach(l => (l.orders || []).forEach(o => { Object.keys(o.i || {}).forEach(t => used.add(t)); Object.keys(o.o || {}).forEach(t => used.add(t)); })); return Object.keys(b.wf || {}).filter(t => !used.has(t) && b.wf[t] >= 1); };
function observe(prev, cur) {
  const ts = pure(cur); if (!ts.length) return null; let one = 0, zero = 0, other = 0, big = false;
  for (const t of ts) { const w = cur.wf[t], d = (prev.inv[t] || 0) - (cur.inv[t] || 0); if (Math.abs(d - w) <= Math.max(1, 0.15 * w)) one++; else if (Math.abs(d) <= 0.5) { zero++; if (w >= 3) big = true; } else other++; }
  if (one >= Math.min(2, ts.length) && zero === 0) return 1;
  if (zero === ts.length && big) return 0;
  return null;
}
const inWin = (m, a, b) => { const off = (((m * MIN - (a % DAY)) % DAY) + DAY) % DAY; return off > 0 && off <= b - a; };
function estimate(obs) {
  const ok = new Array(1440).fill(true); let pos = 0, neg = 0;
  for (const o of obs) { if (o.b - o.a <= 0 || o.b - o.a >= 23 * 36e5) continue; if (o.k) pos++; else neg++; for (let m = 0; m < 1440; m++) { const w = inWin(m, o.a, o.b); if (o.k ? !w : w) ok[m] = false; } }
  const arcs = []; let start = ok.findIndex((v, i) => v && !ok[(i + 1439) % 1440]);
  if (ok.every(v => v)) return { pos, neg, arcs: [], est: null, widthMin: 1440 };
  if (!ok.some(v => v)) return { pos, neg, arcs: [], est: null, widthMin: 0, conflict: true };
  for (let n = 0, i = start; n < 1440; ) { if (ok[i % 1440]) { let j = i; while (ok[(j + 1) % 1440] && j - i < 1440) j++; arcs.push([i % 1440, j % 1440, j - i + 1]); n += j - i + 1; i = j + 1; } else { i++; n++; } }
  const total = arcs.reduce((a, x) => a + x[2], 0);
  if (arcs.length === 1) { const [s, e, w] = arcs[0]; return { pos, neg, arcs, est: (((s + (w - 1) / 2) % 1440) / 60), widthMin: w }; }
  return { pos, neg, arcs, est: null, widthMin: total };
}
function update(store, prevBases, bases) {
  const out = store || {};
  for (const b of bases) { const p = prevBases && prevBases[b.p], cu = new Date(b.upd).getTime(); if (!p || !(cu > p.upd) || !b.inv) continue; const k = observe(p, b); if (k === null) continue; const list = out[b.p] = out[b.p] || []; if (!list.some(o => o.a === p.upd && o.b === cu)) list.push({ a: p.upd, b: cu, k }); out[b.p] = list.filter(o => o.b > Date.now() - 60 * DAY).slice(-300); }
  return out;
}
function summary(store) { const r = {}; for (const [p, list] of Object.entries(store)) r[p] = estimate(list); return r; }
module.exports = { observe, update, summary, estimate };
