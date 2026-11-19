// Goods that move between stores (ship <-> Benten warehouse, store -> CX sell order) are read by FIO at different moments, so a unloaded
// or newly listed good can sit in two stores of one snapshot and get valued twice. This works out how much value is counted twice,
// so net worth can subtract it. It only uses facts in the snapshots: store read times (`fresh`), flight times and item counts.
const HR = 36e5, TOL = 5 * 60e3;
const pv = (px, t) => { const x = px && px[t]; return x ? (x[2] || x[0] || x[1] || 0) : 0; };
const isBen = x => /benten/i.test(String(x || '')) && /station/i.test(String(x || ''));
function whq(s) { const q = {}; for (const w of s.warehouses || []) for (const [k, v] of Object.entries(w.items || {})) q[k] = (q[k] || 0) + v; return q; }
const sortKeys = o => Object.fromEntries(Object.entries(o || {}).sort());
const whT = s => (s.fresh && s.fresh.wh) || 0;
const cT = (s, r) => ((s.fresh && s.fresh.ships && s.fresh.ships[r]) || {}).c || 0;
// older: snapshots before s, newest first
function reconcile(s, older) {
  const px = s.px || {}, wq = whq(s), wF = whT(s), out = { ship: 0, load: 0, ord: 0, adj: 0, items: [] };
  for (const sh of s.ships || []) {
    const c = cT(s, sh.r), arr = sh.arr || 0, dep = sh.dep || 0, cargo = sh.cargo || {};
    const pre = isBen(sh.to) && arr ? older.find(o => o.t < arr && (o.ships || []).some(x => x.r === sh.r && x.arr === arr)) : null;
    const same = pre && JSON.stringify(sortKeys((pre.ships.find(x => x.r === sh.r) || {}).cargo)) === JSON.stringify(sortKeys(cargo));
    if (isBen(sh.to) && arr && arr <= wF + TOL && arr <= s.t && c && (c <= wF || same)) {
      // docked at Benten, and either the ship was read no later than the warehouse or its cargo list has not changed since the flight: whatever the warehouse gained since before the arrival is also still on the ship
      const base = older.find(o => whT(o) && whT(o) < arr && o.t < arr);
      if (!base) continue; const bq = whq(base);
      for (const [t, n] of Object.entries(cargo)) { const m = Math.max(0, Math.min(n, (wq[t] || 0) - (bq[t] || 0))); if (m > 0) { out.ship += m * pv(px, t); out.items.push(sh.r + ' ' + t + ' ' + m); } }
    } else if (isBen(sh.from) && dep && dep > wF && c && dep <= c) {
      // left Benten after the warehouse was read: goods loaded onto the ship are still in the (older) warehouse reading
      const base = older.find(o => cT(o, sh.r) && cT(o, sh.r) < dep && o.t < dep && (o.ships || []).some(x => x.r === sh.r)); if (!base) continue;
      const bc = (base.ships.find(x => x.r === sh.r) || {}).cargo || {};
      for (const [t, n] of Object.entries(cargo)) { const m = Math.max(0, Math.min(n - (bc[t] || 0), wq[t] || 0)); if (m > 0) { out.load += m * pv(px, t); out.items.push(sh.r + ' loaded ' + t + ' ' + m); } }
    }
  }
  // sell orders placed in the last hour: the goods leave the store when listed, but the store reading can still show them
  for (const o of s.orders || []) if (o.s === 'S' && o.ageH < 1) { const m = Math.min(o.n, wq[o.tk] || 0); if (m > 0) { out.ord += m * pv(px, o.tk); out.items.push('order ' + o.tk + ' ' + m); } }
  out.ship = Math.round(out.ship); out.load = Math.round(out.load); out.ord = Math.round(out.ord); out.adj = out.ship + out.load + out.ord;
  if (!out.adj) return null; out.items = out.items.slice(0, 12); return out;
}
module.exports = { reconcile };
