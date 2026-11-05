// one-off: print the shape of the PRUNplanner responses (no key, short values only)
const KEY = process.env.PRUNPLANNER_KEY; const B = 'https://api.prunplanner.org';
const get = async p => { const r = await fetch(B + p, { headers: { Authorization: 'Api-Key ' + KEY } }); console.log(p, r.status); return r.ok ? r.json() : null; };
const shape = (v, d = 0) => { if (v === null) return 'null'; if (Array.isArray(v)) return '[' + v.length + ']' + (v.length && d < 3 ? ' of ' + shape(v[0], d + 1) : ''); if (typeof v === 'object') return d > 3 ? '{…}' : '{' + Object.entries(v).slice(0, 25).map(([k, x]) => k + ':' + shape(x, d + 1)).join(', ') + '}'; return typeof v === 'string' ? JSON.stringify(v.slice(0, 24)) : String(v); };
(async () => {
  if (!KEY) { console.log('no key'); return; }
  const list = await get('/planning/plan/'); if (!list) return; console.log('LIST', shape(list));
  console.log('NAMES', (list.results || list).map(p => (p.name || p.uuid) + '|' + (p.uuid || p.id)).join(' ; '));
  const first = (list.results || list)[0]; const id = first.uuid || first.id;
  const one = await get('/planning/plan/' + id + '/'); console.log('PLAN', shape(one));
  const emp = await get('/planning/empire/'); console.log('EMPIRE', shape(emp));
  const e = emp && (emp.results || emp)[0]; if (e) { const eid = e.uuid || e.id; const io = await get('/planning/empire/' + eid + '/plans/material_io/'); console.log('IO', shape(io)); }
})().catch(e => { console.error(e.message); process.exit(1); });
