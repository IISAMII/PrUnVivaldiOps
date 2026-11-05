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
  const out = { plans }; const f = 'docs/data/plans.json'; const old = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  const txt = JSON.stringify(out); if (txt !== old) { fs.writeFileSync(f, txt); console.log('plans.json updated,', plans.length, 'plans'); } else console.log('no change,', plans.length, 'plans');
})().catch(e => { console.error(e.message); process.exit(1); });
