const DAY = 864e5, HR = 36e5;
const money = n => { const a = Math.abs(n); const s = a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? Math.round(a / 1e3) + 'k' : String(Math.round(a)); return (n < 0 ? '-' : '') + s; };
const cl = (settings, p) => (settings && settings.claim && settings.claim[p] != null) ? settings.claim[p] : (settings && settings.claimH != null ? settings.claimH : 6.25);
function claimsIn(a, b, off) { const o = off * HR, out = []; for (let t = (Math.floor((a - o) / DAY) + 1) * DAY + o; t <= b; t += DAY) out.push(t); return out; }
function prodEvents(b, t0, hz) {
  const ev = {}, add = (t, time, d) => { (ev[t] = ev[t] || []).push([time, d]); };
  for (const l of b.lines || []) {
    const orders = (l.orders || []).filter(o => !o.h); const running = orders.filter(o => o.s), queue = orders.filter(o => !o.s).map(o => Object.assign({}, o));
    const slots = running.map(o => o.e || t0);
    for (const o of running) if (o.e > t0) for (const [t, a] of Object.entries(o.o || {})) add(t, o.e, a);
    while (slots.length < (l.cap || 1)) slots.push(t0);
    let g = 0;
    while (queue.length && g++ < 3000) {
      slots.sort((x, y) => x - y); const start = Math.max(slots[0], t0); if (start > hz) break;
      const o = queue.shift(), dur = o.d || HR;
      for (const [t, a] of Object.entries(o.i || {})) add(t, start, -a);
      for (const [t, a] of Object.entries(o.o || {})) add(t, start + dur, a);
      slots[0] = start + dur; if (o.r) queue.push(o);
    }
  }
  return ev;
}
function idx(T, x) { let lo = 0, hi = T.length; while (lo < hi) { const m = (lo + hi) >> 1; if (T[m] <= x) lo = m + 1; else hi = m; } return lo; }
function runoutsOf(b, now, settings) {
  const t0 = Math.min(now, new Date(b.upd).getTime()), hz = now + 16 * DAY, ev = prodEvents(b, t0, hz), off = cl(settings, b.p), cache = {};
  const ser = t => { if (cache[t]) return cache[t]; const a = (ev[t] || []).slice(), w = (b.wf || {})[t]; if (w) claimsIn(t0, hz, off).forEach(c => a.push([c, -w])); a.sort((x, y) => x[0] - y[0]); const s0 = (b.inv || {})[t] || 0; let bal = s0; const T = [], B = []; for (const [te, d] of a) { bal += d; T.push(te); B.push(bal); } return cache[t] = { T, B, s0 }; };
  const first = t => { const S0 = ser(t), i = idx(S0.T, now); if ((i ? S0.B[i - 1] : S0.s0) < -1e-6) return now; for (let j = i; j < S0.T.length; j++) if (S0.B[j] < -1e-6) return S0.T[j]; return Infinity; };
  const ts = new Set(Object.keys(b.wf || {})); (b.lines || []).forEach(l => (l.orders || []).forEach(o => Object.keys(o.i || {}).forEach(t => ts.add(t))));
  return [...ts].map(t => ({ t, ro: first(t) })).filter(x => x.ro !== Infinity).sort((a, c) => a.ro - c.ro);
}
const ask = (px, t) => { const x = px && px[t]; return x ? (x[0] || x[2] || x[1] || 0) : 0; };
const bid = (px, t) => { const x = px && px[t]; return x ? (x[1] || x[2] || x[0] || 0) : 0; };
const v7 = (px, t) => { const x = px && px[t]; return x ? (x[2] || x[0] || x[1] || 0) : 0; };
const fmt = ms => new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/Amsterdam', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function watch(s, prev, settings, now) {
  now = now || Date.now(); const out = [], px = s.px || {}, push = (level, kind, key, text) => out.push({ level, kind, key, text });
  const demand = {}; (s.bases || []).forEach(b => Object.entries(b.net || {}).forEach(([t, n]) => { if (n < -0.5) demand[t] = true; }));
  (s.bases || []).forEach(b => {
    const age = now - new Date(b.upd).getTime();
    if (b.inv) {
      const ro = runoutsOf(b, now, settings);
      const soon = [];
      ro.slice(0, 6).forEach(r => {
        const hrs = (r.ro - now) / HR; if (hrs > 24) return;
        const covered = (s.ships || []).some(sh => sh.etaH > 0 && String(sh.to || '').includes(b.p) && (sh.cargo || {})[r.t] > 0 && (s.t + sh.etaH * HR) <= r.ro);
        if (covered) return;
        if (hrs <= 5) { if (age <= 8 * HR) push('push', 'supply', 'supply|' + b.p + '|' + r.t, b.p + ': ' + r.t + ' runs out ' + fmt(r.ro) + (hrs > 0 ? ' (in ' + hrs.toFixed(1) + ' h)' : ' (now)') + ', nothing on the way'); else push('list', 'supply', 'supply|' + b.p + '|' + r.t, b.p + ': ' + r.t + ' may run out ' + fmt(r.ro) + ', but the base data is ' + Math.round(age / HR) + ' h old'); }
        else soon.push(r.t + ' ' + hrs.toFixed(0) + ' h');
      });
      if (soon.length) push('list', 'supply', 'supply24|' + b.p, b.p + ' needs supply within a day: ' + soon.slice(0, 5).join(', '));
    }
    (b.lines || []).forEach(l => {
      let tot = 0; const rows = [];
      (l.orders || []).forEach(o => { if (o.h) return; const baseH = (o.d || 0) / HR * (l.eff || 1); const outv = Object.entries(o.o || {}).reduce((a, [t, n]) => a + n * (demand[t] ? Math.max(v7(px, t), ask(px, t)) : v7(px, t)), 0), inv_ = Object.entries(o.i || {}).reduce((a, [t, n]) => a + n * ask(px, t), 0), margin = outv - inv_ - 5 * baseH; const k = Object.keys(o.o || {}).sort().join('+'); let r = rows.find(x => x.k === k); if (!r) rows.push(r = { k, margin: 0, h: 0, n: 0 }); r.margin += margin; r.h += baseH; r.n++; tot += baseH; });
      rows.forEach(r => { if (tot > 0 && r.h / tot >= 0.15 && r.margin < 0) push('push', 'loss', 'loss|' + b.p + '|' + l.ty + '|' + r.k, b.p + ' ' + l.ty + ': ' + r.k + ' now loses about ' + money(-r.margin / r.n) + ' per order at today\'s prices (' + Math.round(r.h / tot * 100) + '% of the line). Stop or replace these orders.'); });
    });
  });
  const pxp = (prev && prev.px) || null;
  if (px.KV) { const a = px.KV[0]; if (a && a < 35000 && (!pxp || !pxp.KV || pxp.KV[0] >= 35000)) push('list', 'rule', 'kv-low', 'KV ask fell below 35k (' + money(a) + '): consider moving the weaving line back to NL.'); }
  if (px.BDE) { const v = px.BDE[2], p0 = pxp && pxp.BDE && pxp.BDE[2]; if (v && p0 && ((v >= 4000) !== (p0 >= 4000))) push('list', 'rule', 'bde-' + (v >= 4000 ? 'up' : 'down'), 'BDE 7-day price ' + (v >= 4000 ? 'rose above' : 'fell below') + ' 4,000 (' + Math.round(v) + '): Yannick ' + (v >= 4000 ? 'is back in play' : 'is off')); }
  if (px.PSL) { const tr = px.PSL[3]; const net = (s.bases || []).reduce((a, b) => a + Math.max(0, (b.net || {}).PSL || 0), 0); if (tr && net / tr > 0.15) push('list', 'rule', 'psl-share', 'PSL is ' + (net / tr * 100).toFixed(1) + '% of the 7-day volume: consider moving a printer off PSL.'); }
  if (pxp) { const seen = new Set(); (s.bases || []).forEach(b => Object.entries(b.net || {}).forEach(([t, n]) => { if (seen.has(t) || !px[t] || !pxp[t]) return; const val = Math.abs(n) * v7(px, t); if (val < 5000) return; const a1 = px[t][0] || px[t][2], a0 = pxp[t][0] || pxp[t][2]; if (!a1 || !a0) return; const ch = a1 / a0 - 1; if (Math.abs(ch) >= 0.08) { seen.add(t); push('list', 'price', 'px|' + t + '|' + (ch > 0 ? 'up' : 'down'), t + ' ask ' + (ch > 0 ? '+' : '') + (ch * 100).toFixed(0) + '% (' + Math.round(a0) + ' to ' + Math.round(a1) + '), about ' + money(val) + ' per day of your flow'); } })); }
  (s.loans || []).forEach(l => { if (l.nextDue && l.nextDue - now <= 2 * DAY && l.nextDue - now > -DAY) push('list', 'loan', 'loan|' + l.id + '|' + l.nextDue, 'Loan ' + l.id + ': installment of ' + money(l.inst) + ' due ' + fmt(l.nextDue)); });
  const oldest = Math.max(...(s.bases || []).map(b => now - new Date(b.upd).getTime()), 0); if (oldest > 12 * HR) push('list', 'stale', 'stale', 'Base data is up to ' + Math.round(oldest / HR) + ' h old: open your bases in the game so supply checks are reliable.');
  return out;
}
if (typeof module !== 'undefined') module.exports = { watch, runoutsOf };
