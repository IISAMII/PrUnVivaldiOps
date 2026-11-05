// Reads the PRUNplanner plans and writes docs/data/plans.json for the Vivaldi Ops plan library.
const fs = require('fs'); const KEY = process.env.PRUNPLANNER_KEY; const B = 'https://api.prunplanner.org';
const get = async p => { for (let i = 0; i < 3; i++) { const r = await fetch(B + p, { headers: { Authorization: 'Api-Key ' + KEY } }); if (r.ok) return r.json(); if (r.status < 500 && r.status !== 429) throw new Error(p + ' ' + r.status); await new Promise(f => setTimeout(f, 3000 * (i + 1))); } throw new Error(p + ' failed'); };
(async () => {
  if (!KEY) { console.log('PRUNPLANNER_KEY missing, nothing synced'); return; }
  const list = await get('/planning/plan/'), arr = list.results || list;
  if (!Array.isArray(arr) || !arr.length) throw new Error('no plans returned');
  const io = {}; const emps = await get('/planning/empire/');
  for (const e of (emps.results || emps)) { const r = await get('/planning/empire/' + e.uuid + '/plans/material_io/'); for (const x of (r.rows || [])) { (io[x.plan_uuid] = io[x.plan_uuid] || {})[x.ticker] = [Math.round(x.production * 1e3) / 1e3, Math.round(x.consumption * 1e3) / 1e3]; } }
  const plans = arr.map(p => { const d = p.plan_data || {}, blds = {};
    for (const b of d.buildings || []) blds[b.name] = (blds[b.name] || 0) + b.amount;
    for (const b of d.infrastructure || []) if (b.amount > 0) blds[b.building] = (blds[b.building] || 0) + b.amount;
    const exp = (d.experts || []).filter(x => x.amount > 0).map(x => x.amount + ' ' + String(x.type).toLowerCase()).join(', ');
    return { id: p.uuid.slice(0, 8), uuid: p.uuid, name: p.plan_name, planet: p.planet_natural_id, cogc: p.plan_cogc || null, permits: p.plan_permits_used, blds, exp: exp || 'none', io: io[p.uuid] || null, modified: p.modified_at };
  }).sort((a, b) => a.id < b.id ? -1 : 1);
  try { const bl = await get('/data/buildings/'), bo = {}; for (const b of (bl.results || bl)) bo[b.building_ticker] = { c: (b.costs || []).map(x => x.material_ticker + ':' + x.material_amount).join(' '), a: b.area_cost, w: [b.pioneers || 0, b.settlers || 0, b.technicians || 0, b.engineers || 0, b.scientists || 0] };
    const bf = 'docs/data/buildings.json', bt = JSON.stringify(bo); if (!fs.existsSync(bf) || fs.readFileSync(bf, 'utf8') !== bt) { fs.writeFileSync(bf, bt); console.log('buildings.json updated'); } } catch (e) { console.log('buildings skipped:', e.message); }
  try { const ms = await get('/data/market/summary/'), arr2 = Array.isArray(ms) ? ms : (ms.results || Object.values(ms)).flat ? (ms.results || Object.values(ms)).flat() : [], pr = {};
    for (const x of arr2) if (x && x.ticker) pr[x.ticker] = [x.vwap_7d, x.vwap_30d, x.units_7d && x.turnover_7d_by_exchange && x.turnover_7d_by_exchange.CI1 && x.vwap_7d ? Math.round(x.turnover_7d_by_exchange.CI1 / x.vwap_7d / 7 * 100) / 100 : null];
    const pf = 'docs/data/prices.json', pt = JSON.stringify(pr); if (Object.keys(pr).length && (!fs.existsSync(pf) || fs.readFileSync(pf, 'utf8') !== pt)) { fs.writeFileSync(pf, pt); console.log('prices.json updated,', Object.keys(pr).length, 'tickers'); } } catch (e) { console.log('prices skipped:', e.message); }
  const planets = {}; const now = Date.now();
  for (const nid of [...new Set(plans.map(p => p.planet).filter(Boolean))]) {
    try { const a = await get('/data/planet/' + nid + '/'), b = await get('/data/planet/' + nid + '/popr/');
      const all = (a.cogc_programs || []).slice().sort((x, y) => x.start_epochms - y.start_epochms); let cur = all.find(c => c.start_epochms <= now && c.end_epochms > now);
      // the same program runs on in consecutive weeks: follow the chain to its last end
      if (cur) { let nx; while ((nx = all.find(c => c.start_epochms === cur.end_epochms && c.program_type === cur.program_type))) cur = nx; }
      planets[nid] = { cogc: a.active_cogc_program_type || null, cogcEnd: cur ? new Date(cur.end_epochms).toISOString().slice(0, 10) : null, free: [b.free_pioneer, b.free_settler, b.free_technician, b.free_engineer, b.free_scientist].map(x => x || 0) }; } catch (e) { console.log('planet', nid, 'skipped:', e.message); } }
  const out = { plans, planets }; const f = 'docs/data/plans.json'; const old = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  const txt = JSON.stringify(out); if (txt !== old) { fs.writeFileSync(f, txt); console.log('plans.json updated,', plans.length, 'plans'); } else console.log('no change,', plans.length, 'plans');
})().catch(e => { console.error(e.message); process.exit(1); });
