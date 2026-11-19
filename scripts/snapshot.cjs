// Scheduled job: takes a FIO snapshot, runs the watch rules, stores data under docs/data and pushes urgent alerts via ntfy.
const fs = require('fs'), path = require('path');
const { opsSnapshot } = require('./collector.cjs');
const { watch, groupPush } = require('./watchcore.cjs');
const claims = require('./claims.cjs');
const shipNotify = require('./shipnotify.cjs');
const D = path.join(__dirname, '..', 'docs', 'data'); fs.mkdirSync(D, { recursive: true });
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(D, f), 'utf8')); } catch (e) { return d; } };
const wr = (f, o) => fs.writeFileSync(path.join(D, f), JSON.stringify(o));
const { reconcile } = require('./recon.cjs');
const poprTrack = require('./popr.cjs');
const HR = 36e5, DAY = 864e5, USER = 'II_SAM';
const ams = t => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
const amsH = t => +new Date(t).toLocaleString('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hourCycle: 'h23' });

function lean(s, keepBook) {
  const o = JSON.parse(JSON.stringify(s)); delete o.recipes; delete o.cashFio; if (!keepBook) delete o.book;
  (o.bases || []).forEach(b => { delete b.lines; }); return o;
}
// keep everything < 24 h, then one per 6 h up to 14 days, then one per day, at most 180 entries
function thin(h, now) {
  const seen = new Set(), out = [];
  for (const s of h.slice().sort((a, b) => b.t - a.t)) {
    const age = now - s.t; let k;
    if (age < DAY) k = 's' + s.t; else if (age < 14 * DAY) k = 'q' + Math.floor(s.t / (6 * HR)); else k = 'd' + Math.floor(s.t / DAY);
    if (seen.has(k)) continue; seen.add(k); out.push(s);
  }
  return out.slice(0, 180);
}
async function push(text) {
  const topic = process.env.NTFY_TOPIC; if (!topic) { console.log('no NTFY_TOPIC, push skipped:', text); return; }
  try { const r = await fetch('https://ntfy.sh/' + encodeURIComponent(topic), { method: 'POST', headers: { Title: 'Vivaldi Ops', Priority: 'high', Tags: 'warning' }, body: text }); console.log('ntfy', r.status); } catch (e) { console.log('ntfy failed', e.message); }
}
function addAlert(alerts, a, now) {
  const win = a.level === 'push' ? 12 * HR : 20 * HR;
  if (alerts.some(x => x.key === a.key && now - x.t < win)) return false;
  alerts.unshift(a); return true;
}

(async () => {
  const now = Date.now(); const alerts = rd('alerts.json', []).filter(x => !(x.key === 'run-fail' && /secret missing/.test(x.text))); let newPush = [];
  if (process.env.TEST_PUSH === 'true') await push('Test message from Vivaldi Ops. If you see this, phone alerts work.');
  const KEY = process.env.FIO_KEY;
  let s; const meta = rd('meta.json', null);
  try { if (!KEY) throw new Error('FIO_KEY secret missing'); s = await opsSnapshot(KEY, USER);
    const prevN = meta && meta.bases ? Object.keys(meta.bases).length : 0;
    if (!s.bases || !s.bases.length || s.bases.some(b => !b.p || !b.nB) || s.bases.length < prevN) throw new Error('FIO returned incomplete base data (' + (s.bases || []).length + ' of ' + prevN + ' bases), snapshot discarded'); }
  catch (e) {
    console.log('snapshot failed:', e.message);
    const recent = alerts.some(x => x.key === 'run-fail' && now - x.t < 6 * HR);
    const lastOk = meta ? meta.t : 0; // one-off outages (FIO 5xx) only push when no snapshot succeeded for 2 h
    if (!recent && (!KEY || !meta || now - lastOk > 2 * HR)) { const msg = 'Snapshot job failed: ' + String(e.message).slice(0, 160); alerts.unshift({ t: now, level: 'push', kind: 'run', key: 'run-fail', text: msg, snapT: now }); await push(msg + '. Stale FIO data does not cause this; check the key or the Actions tab.'); }
    wr('alerts.json', alerts.slice(0, 80)); return;
  }
  const settings0 = rd('settings.json', {});
  // worker claim times seen in the stock changes between FIO readings
  const store = claims.update(rd('claimobs.json', {}), meta && meta.bases, s.bases);
  let popr = rd('popr.json', {}); try { const pr = await poprTrack.run(s, popr); popr = pr.state; pr.notes.forEach(n => console.log('popr:', n)); wr('popr.json', popr); } catch (e) { console.log('popr failed', e.message); }
  const dr = claims.detectResets(meta && meta.bases, s.bases, rd('claimreset.json', {}), popr); wr('claimreset.json', dr.resets);
  for (const n of dr.notes) addAlert(alerts, { t: s.t, level: 'list', kind: 'claim', key: 'claimreset-' + n.p + '-' + n.t, text: n.p + ': more workers arrived (worker need ' + Math.round(n.from) + ' to ' + Math.round(n.to) + (n.popr ? ', with the weekly population report' : ', not at a population report') + '). Claim time is measured again.', snapT: s.t }, now);
  const csum = claims.summary(store, dr.resets, popr);
  const settings = Object.assign({}, settings0, { claim: Object.assign({}, settings0.claim) });
  for (const [p, c] of Object.entries(csum)) if (c.est != null && c.widthMin <= 60) settings.claim[p] = c.est;
  wr('claimobs.json', store); wr('claims.json', csum);
  const found = watch(s, meta && meta.px ? { px: meta.px } : null, settings, now);
  for (const a of found) { const rec = { t: s.t, level: a.level, kind: a.kind, key: a.key, text: a.text, snapT: s.t }; if (a.base) rec.base = a.base; if (a.level === 'push' && a.base) { rec.tk = a.tk; rec.ro = a.ro; rec.hrs = a.hrs; } if (addAlert(alerts, rec, now) && a.level === 'push') newPush.push(rec); }
  newPush = groupPush(newPush, alerts, now);
  // history
  const hist = rd('history.json', []).filter(x => x.t !== s.t);
  { const rc = reconcile(s, hist.slice().sort((a, b) => b.t - a.t)); if (rc) { s.recon = rc; console.log('recon: counted twice', rc.adj, rc.items.join('; ')); } }
  const day = ams(s.t); const keepBook = !hist.some(x => x.book && ams(x.t) === day);
  // only keep a new history point when FIO data changed (or 3 h passed); FIO updates only when Sam opens things in the game
  const sig = x => JSON.stringify([(x.bases || []).map(b => [b.p, new Date(b.upd).getTime()]), (x.ships || []).map(h => [h.r, h.arr, h.cargo])]);
  if (!(hist[0] && sig(hist[0]) === sig(s) && s.t - hist[0].t < 3 * HR)) hist.unshift(lean(s, keepBook));
  delete s.cashFio;
  { const tr = rd('trades.json', []), seen = new Set(tr.map(t => t.id)); let add = 0; for (const t of (s.trades || [])) if (!seen.has(t.id)) { tr.push(t); add++; } if (add || !tr.length) wr('trades.json', tr.sort((a, b) => a.ts - b.ts)); }
  { // freshness log: when FIO last saw each store, every snapshot, kept 3 days (to see what FIO receives while the game is open but the PC is locked)
    const fl = rd('freshlog.json', []).filter(x => x.t > now - 3 * DAY), f = s.fresh || {};
    fl.push({ t: s.t, ships: Object.fromEntries(Object.entries(f.ships || {}).map(([r, v]) => [r, [v.f, v.c]])), bases: f.bases || {}, wh: f.wh || null }); wr('freshlog.json', fl); }
  wr('latest.json', s); wr('history.json', thin(hist, now)); wr('alerts.json', alerts.slice(0, 80)); wr('meta.json', { t: s.t, px: s.px, bases: Object.fromEntries(s.bases.map(b => [b.p, { upd: new Date(b.upd).getTime(), inv: b.inv }])) });
  console.log('snapshot', new Date(s.t).toISOString(), 'alerts', found.length, 'push', newPush.length);
  for (const t of newPush) await push(t);
  try { const r = await shipNotify.run(s, rd('shipnotify.json', { flights: {} }), process.env.NTFY_TOPIC, now); wr('shipnotify.json', r.state); (r.notes || []).forEach(n => console.log('shipnotify:', n)); const tn = (r.notes || []).find(n => /^self-test/.test(n)); if (tn) { alerts.unshift({ t: now, level: 'list', kind: 'run', key: 'shipnotify-test-' + now, text: 'Ship messages: ' + (r.canCancel ? 'ntfy can cancel queued messages (stale ones are removed)' : 'ntfy could NOT cancel queued messages here; a changed flight may still send an old time') + ' - ' + tn.slice(0, 120), snapT: now }); wr('alerts.json', alerts.slice(0, 80)); } }
  catch (e) { console.log('shipnotify failed:', e.message); }
})().catch(e => { console.error(e); process.exit(1); });
