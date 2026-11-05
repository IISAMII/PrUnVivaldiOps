const KEY = process.env.PRUNPLANNER_KEY; const B = 'https://api.prunplanner.org';
(async () => { const r = await fetch(B + '/data/buildings/', { headers: { Authorization: 'Api-Key ' + KEY } }); console.log('status', r.status); const j = await r.json(); const a = j.results || j; console.log('count', a.length);
  const f = a.find(x => (x.ticker || x.name) === 'PP1') || a[0]; console.log('PP1', JSON.stringify(f).slice(0, 1500)); console.log('PP2', JSON.stringify(a.find(x => (x.ticker || x.name) === 'PP2')).slice(0, 600)); })().catch(e => console.log(e.message));
