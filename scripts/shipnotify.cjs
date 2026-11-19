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
// One-off check (about 2 minutes): queue two messages 90 s ahead, cancel one, wait, and see which one is delivered, and that neither came at once.
async function selfTest(topic, now) {
  const id = now.toString(36), out = { v: 4, t: now, ok: false, cancel: false };
  const A = 'selftest keep ' + id, B = 'selftest cancel ' + id;
  try {
    out.postA = await schedule(topic, 'selftest-a-' + id, now + 90e3, A);
    out.postB = await schedule(topic, 'selftest-b-' + id, now + 90e3, B);
    if (out.postA !== 200 || out.postB !== 200) return out;
    out.ok = true;
    const d = await fetch(url(topic, 'selftest-b-' + id), { method: 'DELETE' }); out.del = d.status;
    const early = await listing(topic, 'since=all'); out.early = { A: early.text.includes(A), B: early.text.includes(B) };
    await sleep(110e3);
    const late = await listing(topic, 'since=all'); out.late = { A: late.text.includes(A), B: late.text.includes(B), s: late.s };
    out.queued = !out.early.A && !out.early.B;
    out.cancel = out.queued && out.late.A && !out.late.B;
  } catch (e) { out.err = String(e.message).slice(0, 80); }
  return out;
}
async function run(s, state, topic, now, log) {
  state = state || { flights: {} }; state.flights = state.flights || {};
  if (!topic) return { state, note: 'no topic' };
  const notes = [];
  if (!state.test || state.test.v !== 4 || (!state.test.cancel && now - state.test.t > 12 * HR)) { state.test = await selfTest(topic, now); notes.push('self-test ' + JSON.stringify(state.test)); console.log('shipnotify selftest', JSON.stringify(state.test)); }
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
