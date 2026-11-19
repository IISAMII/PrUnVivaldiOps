// Weekly population report (POPR) release instant per planet from FIO (/infrastructure/<planet>, public). The release time of day never changes,
// so one report timestamp per base is enough (instants are ts + k weeks). Cached in popr.json; fetched only for bases that are not cached yet.
async function getTs(nid) {
  const r = await fetch('https://rest.fnar.net/infrastructure/' + encodeURIComponent(nid));
  if (!r.ok) throw new Error('FIO ' + r.status);
  const j = await r.json(), reps = (j.InfrastructureReports || []).filter(x => x.TimestampMs);
  return reps.length ? Math.max(...reps.map(x => x.TimestampMs)) : null;
}
async function run(s, state) {
  state = state || {}; const notes = [];
  for (const b of s.bases || []) {
    if (!b.nid || (state[b.p] && state[b.p].ts && state[b.p].nid === b.nid)) continue;
    try { const ts = await getTs(b.nid); if (ts) { state[b.p] = { nid: b.nid, ts }; notes.push(b.p + ' POPR ' + new Date(ts).toISOString()); } } catch (e) { notes.push(b.p + ': ' + String(e.message).slice(0, 60)); }
  }
  return { state, notes };
}
module.exports = { run };
