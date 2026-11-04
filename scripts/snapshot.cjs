// Scheduled job: takes a FIO snapshot, runs the watch rules, stores data under docs/data and pushes urgent alerts via ntfy.
const fs = require('fs'), path = require('path');
const { opsSnapshot } = require('./collector.cjs');
const { watch } = require('./watchcore.cjs');
const D = path.join(__dirname, '..', 'docs', 'data'); fs.mkdirSync(D, { recursive: true });
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(D, f), 'utf8')); } catch (e) { return d; } };
const wr = (f, o) => fs.writeFileSync(path.join(D, f), JSON.stringify(o));
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
  let s;
  try { if (!KEY) throw new Error('FIO_KEY secret missing'); s = await opsSnapshot(KEY, USER); }
  catch (e) {
    console.log('snapshot failed:', e.message);
    const recent = alerts.some(x => x.key === 'run-fail' && now - x.t < 6 * HR);
    if (!recent) alerts.unshift({ t: now, level: 'list', kind: 'run', key: 'run-fail', text: 'Snapshot job failed: ' + String(e.message).slice(0, 160), snapT: now });
    wr('alerts.json', alerts.slice(0, 80)); return;
  }
  const settings = rd('settings.json', {}), meta = rd('meta.json', null);
  const found = watch(s, meta && meta.px ? { px: meta.px } : null, settings, now);
  for (const a of found) { const rec = { t: s.t, level: a.level, kind: a.kind, key: a.key, text: a.text, snapT: s.t }; if (addAlert(alerts, rec, now) && a.level === 'push') newPush.push(a.text); }
  // history
  const hist = rd('history.json', []).filter(x => x.t !== s.t);
  const day = ams(s.t); const keepBook = !hist.some(x => x.book && ams(x.t) === day);
  hist.unshift(lean(s, keepBook));
  delete s.cashFio;
  wr('latest.json', s); wr('history.json', thin(hist, now)); wr('alerts.json', alerts.slice(0, 80)); wr('meta.json', { t: s.t, px: s.px });
  console.log('snapshot', new Date(s.t).toISOString(), 'alerts', found.length, 'push', newPush.length);
  for (const t of newPush) await push(t);
})().catch(e => { console.error(e); process.exit(1); });
