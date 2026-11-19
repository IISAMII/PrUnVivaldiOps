// Silent phone messages (ntfy, low priority) for ship arrivals. Each flight's arrival time is fixed in FIO, so the message is queued on the ntfy server
// for that moment (Delay header); the next snapshot re-checks it and cancels it if the flight changed or is gone. Messages carry a sequence id so they can be cancelled.
const HR = 36e5;
const shortId = r => String(r || '').replace(/^AVI-/, '');
function place(x) {
  const p = String(x || '').split(' - '), sysRaw = (p[0] || '').trim(), locRaw = (p[1] || '').trim();
  const code = (sysRaw.match(/\(([^)]+)\)/) || [])[1] || '', sys = sysRaw.replace(/\s*\(.*\)/, '').trim(), loc = locRaw.replace(/\s*\(.*\)/, '').trim();
  if (/^STATION$/i.test(locRaw)) return { kind: 'station', name: sys };
  if (/^ORBIT$/i.test(locRaw)) return { kind: 'orbit', name: code || sys };
  return { kind: 'base', name: loc || sys };
}
function textOf(sh) {
  const to = place(sh.to), from = place(sh.from), id = shortId(sh.r);
  if (to.kind === 'orbit') { const next = from.kind === 'station' ? 'Umbra or Katoa' : /umbra/i.test(from.name) ? 'Katoa' : /katoa/i.test(from.name) ? 'Benten' : 'the next stop'; return id + ' is in ' + to.name + ' orbit: send it on (usually to ' + next + ')'; }
  if (to.kind === 'station') return id + ' is back at ' + to.name;
  if (/umbra/i.test(to.name)) return id + ' arrived at Umbra: needs the next command (usually to orbit)';
  if (/katoa/i.test(to.name)) return id + ' arrived at Katoa: needs the next command (usually to Benten)';
  return id + ' arrived at ' + to.name + ' (it flies back by itself)';
}
const url = (topic, seq) => 'https://ntfy.sh/' + encodeURIComponent(topic) + (seq ? '/' + encodeURIComponent(seq) : '');
async function schedule(topic, seq, atMs, body) {
  const r = await fetch(url(topic, seq), { method: 'POST', headers: { Title: 'Vivaldi Ops ship', Priority: 'low', Tags: 'rocket', Delay: String(Math.round(atMs / 1000)) }, body });
  return r.status;
}
async function cancel(topic, seq) { const r = await fetch(url(topic, seq), { method: 'DELETE' }); return r.status; }
async function listing(topic, q) {
  const r = await fetch(url(topic) + '/json?poll=1&' + q); const text = r.ok ? await r.text() : '';
  return { s: r.status, text };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
// One-off check (about 3 min): (1) five importance levels, delayed 60 s; (2) four ways to cancel a queued message.
async function selfTest(topic, now) {
  const id = now.toString(36), out = { v: 6, t: now, ok: false, cancel: false, pri: {}, var: {} };
  const post = async (path, title, body, pri, delayMs, extra) => {
    const h = Object.assign({ Title: title, Priority: pri, Tags: 'test_tube' }, extra || {});
    if (delayMs) h.Delay = String(Math.round((now + delayMs) / 1000));
    try { const r = await fetch(url(topic) + path, { method: 'POST', headers: h, body }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, id: j.id }; } catch (e) { return { s: String(e.message).slice(0, 40) }; }
  };
  try {
    const names = { 1: 'min', 2: 'low', 3: 'default', 4: 'high', 5: 'urgent' };
    for (const p of [1, 2, 3, 4, 5]) out.pri[p] = (await post('', 'Importance ' + p + ' of 5 (' + names[p] + ')', 'Test, priority ' + p + ', delayed 1 min', p, 60e3)).s;
    const V = {
      pathSeq: async () => { const q = 'cx-a-' + id; const r = await post('/' + q, 'Cancel test A', 'cancel A ' + id + ' (should NOT arrive)', 'low', 60e3); const d = await fetch(url(topic) + '/' + q, { method: 'DELETE' }); return { post: r.s, del: d.status }; },
      headerSeq: async () => { const q = 'cx-b-' + id; const r = await post('', 'Cancel test B', 'cancel B ' + id + ' (should NOT arrive)', 'low', 60e3, { 'X-Sequence-ID': q }); const d = await fetch(url(topic) + '/' + q, { method: 'DELETE' }); return { post: r.s, del: d.status }; },
      msgId: async () => { const r = await post('', 'Cancel test C', 'cancel C ' + id + ' (should NOT arrive)', 'low', 60e3); const d = r.id ? await fetch(url(topic) + '/' + r.id, { method: 'DELETE' }) : { status: 'noid' }; return { post: r.s, del: d.status }; },
      clearFlag: async () => { const q = 'cx-d-' + id; const r = await post('/' + q, 'Cancel test D', 'cancel D ' + id + ' (should NOT arrive)', 'low', 60e3); const d = await fetch(url(topic) + '/' + q + '/clear', { method: 'PUT' }); return { post: r.s, del: d.status }; }
    };
    for (const k of Object.keys(V)) out.var[k] = await V[k]();
    out.ok = true;
    await sleep(100e3);
    const late = await listing(topic, 'since=all');
    const lines = late.text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return {}; } });
    const tag = { pathSeq: 'cancel A ', headerSeq: 'cancel B ', msgId: 'cancel C ', clearFlag: 'cancel D ' };
    for (const k of Object.keys(V)) {
      V[k].arrived = lines.some(m => m.event === 'message' && (m.message || '').includes(tag[k] + id));
      V[k].events = lines.filter(m => (m.message || '').includes(tag[k] + id) || (m.sequence_id || '').startsWith('cx-' + 'abcd'['pathSeq headerSeq msgId clearFlag'.split(' ').indexOf(k)] + '-' + id)).map(m => m.event).join(',');
    }
    out.cancel = Object.values(out.var).some(v => v.arrived === false);
    out.works = Object.keys(out.var).filter(k => out.var[k].arrived === false);
  } catch (e) { out.err = String(e.message).slice(0, 80); }
  return out;
}
async function run(s, state, topic, now, log) {
  state = state || { flights: {} }; state.flights = state.flights || {};
  if (!topic) return { state, note: 'no topic' };
  const notes = [];
  if (!state.test || state.test.v !== 6) { state.test = await selfTest(topic, now); notes.push('self-test ' + JSON.stringify(state.test)); console.log('shipnotify selftest', JSON.stringify(state.test)); }
  const canCancel = !!(state.test && state.test.cancel);
  const live = {};
  for (const sh of s.ships || []) if (sh.fid && sh.arr) live[sh.fid] = sh;
  // flights that changed or were cancelled before they arrived: take their queued messages back
  for (const [fid, f] of Object.entries(state.flights)) {
    const sh = live[fid];
    if (f.arr <= now - 10 * 60e3) { delete state.flights[fid]; continue; }
    if (!sh || Math.abs(sh.arr - f.arr) > 2 * 60e3) {
      if (f.arr > now + 30e3 && f.sent && canCancel) { try { await cancel(topic, f.seq); notes.push('cancelled ' + f.seq); } catch (e) { notes.push('cancel failed ' + f.seq); } }
      delete state.flights[fid];
    }
  }
  for (const [fid, sh] of Object.entries(live)) {
    if (state.flights[fid]) continue;
    if (sh.arr < now + 60e3 || sh.arr > now + 2.9 * 24 * HR) continue; // already arrived (never announce a past flight) or too far ahead
    const seq = canCancel ? 'ship-' + fid.slice(0, 16) + '-' + now.toString(36) : null;
    let st; try { st = await schedule(topic, seq, sh.arr, textOf(sh)); } catch (e) { st = 0; }
    state.flights[fid] = { r: sh.r, arr: sh.arr, seq, sent: st === 200, at: now };
    notes.push((st === 200 ? 'queued ' : 'FAILED (' + st + ') ') + textOf(sh) + ' for ' + new Date(sh.arr).toISOString());
  }
  return { state, notes, canCancel };
}
if (typeof module !== 'undefined') module.exports = { run, textOf, place };
