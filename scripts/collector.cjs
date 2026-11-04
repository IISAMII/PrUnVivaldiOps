async function opsSnapshot(KEY, USER) {
  const BOMT = ["BBH","BDE","BSE","BTA","C","COF","DW","EXO","H","HCP","HSE","KOM","LBH","LDE","LSE","LTA","MAI","MCG","MGS","OVE","PG","PSL","PT","PWO","RAT","RCO","REP","TRU"];
  const fio = async p => { let err; for (let i = 0; i < 4; i++) { try { const r = await fetch('https://rest.fnar.net' + p, { headers: { Authorization: KEY } }); if (r.ok) return r.json(); err = new Error(p + ' HTTP ' + r.status); if (r.status < 500 && r.status !== 429) throw err; } catch (e) { err = e; if (/HTTP 4(?!29)/.test(e.message)) throw e; } await new Promise(z => setTimeout(z, 4000 * (i + 1))); } throw err; };
  const [user, burn, storage, ships, flights, cxos, sites, prod, cons, blds, whs, prices, recs] = await Promise.all([
    fio('/user/' + USER), fio('/fioweb/burn/user/' + USER), fio('/storage/' + USER), fio('/ship/ships/' + USER), fio('/ship/flights/' + USER),
    fio('/cxos/' + USER), fio('/sites/' + USER), fio('/production/' + USER), fio('/contract/allcontracts'),
    fetch('https://rest.fnar.net/building/allbuildings').then(r => r.json()),
    fio('/sites/warehouses/' + USER),
    fetch('https://refined-prun.github.io/refined-prices/all.json').then(r => r.json()),
    fetch('https://rest.fnar.net/recipes/allrecipes').then(r => r.json())]);
  const now = Date.now(), CX = 'CI1', P = {};
  prices.filter(x => x.ExchangeCode === CX).forEach(x => P[x.MaterialTicker] = x);
  const v7 = t => { const x = P[t]; return x ? (x.VWAP7D || x.Ask || x.Bid || 0) : 0; };
  const ask = t => { const x = P[t]; return x ? (x.Ask || x.VWAP7D || 0) : 0; };
  const r0 = n => Math.round(n), r2 = n => Math.round(n * 100) / 100;
  const items = s => (s.StorageItems || []).filter(i => i.MaterialTicker);
  const imap = s => Object.fromEntries(items(s).map(i => [i.MaterialTicker, i.MaterialAmount]));
  const val = s => items(s).reduce((a, i) => a + i.MaterialAmount * v7(i.MaterialTicker), 0);
  const siteName = {}; sites.forEach(s => siteName[s.SiteId] = s.PlanetName);
  const bcost = {}; blds.forEach(b => bcost[b.Ticker] = (b.BuildingCosts || []).reduce((a, c) => a + c.Amount * ask(c.CommodityTicker), 0));
  const consumed = new Set(), produced = new Set(), pxT = new Set();
  const netBy = {};
  burn.forEach(b => {
    const net = {};
    (b.WorkforceConsumption || []).concat(b.OrderConsumption || []).forEach(c => net[c.MaterialTicker] = (net[c.MaterialTicker] || 0) - c.DailyAmount);
    (b.OrderProduction || []).forEach(c => net[c.MaterialTicker] = (net[c.MaterialTicker] || 0) + c.DailyAmount);
    netBy[b.PlanetName] = net;
    Object.entries(net).forEach(([t, v]) => { if (v < -0.001) consumed.add(t); else if (v > 0.001) produced.add(t); pxT.add(t); });
  });
  const roleOf = (t, bn) => {
    if (bn && netBy[bn] && netBy[bn][t] != null && Math.abs(netBy[bn][t]) > 0.001) return netBy[bn][t] < 0 ? 'S' : 'P';
    if (bn) return 'O';
    const c = consumed.has(t), p = produced.has(t); return c && p ? 'B' : c ? 'S' : p ? 'P' : 'O';
  };
  const split = (s, bn, toBenten) => { const o = { S: 0, P: 0, O: 0 }; items(s).forEach(i => { let r = roleOf(i.MaterialTicker, bn); if (r === 'B') r = toBenten ? 'P' : 'S'; o[r] += i.MaterialAmount * v7(i.MaterialTicker); pxT.add(i.MaterialTicker); }); return { S: r0(o.S), P: r0(o.P), O: r0(o.O) }; };
  const tot = { stock: 0, wh: 0, ships: 0, fuel: 0, build: 0 };
  const sp = { S: 0, P: 0, O: 0 };
  const addSp = x => { sp.S += x.S; sp.P += x.P; sp.O += x.O; };
  const baseStore = {};
  storage.forEach(s => {
    const v = val(s);
    if (s.Type === 'STORE') { const bn = siteName[s.AddressableId] || s.Name; tot.stock += v; baseStore[bn] = s; }
    else if (s.Type === 'WAREHOUSE_STORE') tot.wh += v;
    else if (s.Type === 'SHIP_STORE') tot.ships += v;
    else tot.fuel += v;
  });
  const fl = Object.fromEntries(flights.map(f => [f.FlightId, f]));
  const bases = burn.map(b => {
    const st = sites.find(s => s.PlanetName === b.PlanetName) || { Buildings: [] };
    const store = baseStore[b.PlanetName];
    const inv = {}; (b.Inventory || []).forEach(i => { if (i.MaterialTicker) inv[i.MaterialTicker] = i.MaterialAmount; });
    const net = netBy[b.PlanetName] || {};
    const wf = {}; (b.WorkforceConsumption || []).forEach(c => wf[c.MaterialTicker] = r2((wf[c.MaterialTicker] || 0) + c.DailyAmount));
    const sv = store ? split(store, b.PlanetName) : { S: 0, P: 0, O: 0 }; addSp(sv);
    let bv = 0; st.Buildings.forEach(x => bv += (bcost[x.BuildingTicker] || 0) * x.Condition); tot.build += bv;
    const cond = st.Buildings.map(x => x.Condition);
    const rep = st.Buildings.map(x => x.BuildingLastRepair || x.BuildingCreated);
    const lines = prod.filter(l => l.PlanetName === b.PlanetName).map(l => ({
      ty: l.Type, cap: l.Capacity, eff: r2(l.Efficiency),
      orders: l.Orders.map(o => ({ s: o.StartedEpochMs || 0, e: o.CompletionEpochMs || 0, d: o.DurationMs || 0, r: o.Recurring ? 1 : 0, h: o.IsHalted ? 1 : 0,
        i: Object.fromEntries((o.Inputs || []).map(x => [x.MaterialTicker, x.MaterialAmount])), o: Object.fromEntries((o.Outputs || []).map(x => [x.MaterialTicker, x.MaterialAmount])) }))
    }));
    Object.keys(inv).forEach(t => pxT.add(t));
    return { p: b.PlanetName, nid: b.PlanetNaturalId, founded: st.PlanetFoundedEpochMs ? new Date(st.PlanetFoundedEpochMs).toISOString() : null, upd: b.LastUpdate, inv, wf, net: Object.fromEntries(Object.entries(net).map(([k, v]) => [k, r2(v)])),
      stockVal: r0(val(store || { StorageItems: [] })), split: sv, bldVal: r0(bv), nB: st.Buildings.length,
      avgCond: Math.round(cond.reduce((a, c) => a + c, 0) / Math.max(1, cond.length) * 1000) / 1000, minCond: Math.round(Math.min(...cond, 1) * 1000) / 1000,
      oldestRepairD: rep.length ? r0((now - Math.min(...rep)) / 864e5) : 0, lines };
  });
  const whName = {}; whs.forEach(w => whName[w.WarehouseId] = w.LocationName);
  const warehouses = storage.filter(s => s.Type === 'WAREHOUSE_STORE').map(s => { const sv = split(s, null, false); addSp(sv); return { name: whName[s.AddressableId] || s.Name, items: imap(s), split: sv }; });
  const shipRows = ships.map(s => {
    const f = fl[s.FlightId], c = storage.find(x => x.StorageId === s.StoreId);
    const toBen = f ? /benten/i.test(f.Destination || '') : false;
    const sv = c ? split(c, null, toBen) : { S: 0, P: 0, O: 0 }; addSp(sv);
    return { r: s.Registration, cond: r2(s.Condition), fid: f ? f.FlightId : null, dep: f ? f.DepartureTimeEpochMs : null, arr: f ? f.ArrivalTimeEpochMs : null, fuel: f ? r0((f.Segments || []).reduce((a, g) => a + (g.StlFuelConsumption || 0) + (g.FtlFuelConsumption || 0), 0)) : 0, dmg: f ? Math.round((f.Segments || []).reduce((a, g) => a + (g.Damage || 0), 0) * 1e4) / 1e4 : 0, to: f ? f.Destination : null, from: f ? f.Origin : null, etaH: f ? r2((f.ArrivalTimeEpochMs - now) / 3.6e6) : 0,
      cargo: c ? imap(c) : {}, cargoVal: c ? r0(val(c)) : 0, split: sv, wl: c ? r0(c.WeightLoad) : 0, vl: c ? r0(c.VolumeLoad) : 0, wc: c ? r0(c.WeightCapacity) : 0, vc: c ? r0(c.VolumeCapacity) : 0 };
  });
  const orders = cxos.filter(o => o.Status !== 'FILLED').map(o => ({ s: o.OrderType[0], tk: o.MaterialTicker, n: o.Amount, lim: o.Limit, st: o.Status, ageH: r2((now - o.CreatedEpochMs) / 3.6e6) }));
  const trades = cxos.flatMap(o => (o.Trades || []).map(t => ({ id: t.CXOSTradeId, ts: t.TradeTimeEpochMs, s: o.OrderType[0], tk: o.MaterialTicker, n: t.Amount, p: r2(t.Price), v7: r2(v7(o.MaterialTicker)) })));
  const amt = x => x && x.Amount && x.Amount.Amount ? x.Amount.Amount : (x && x.Amount) || 0;
  const loans = cons.filter(c => c.Conditions.some(x => x.Type === 'LOAN_INSTALLMENT' && x.Party === c.Party)).map(c => {
    const ins = c.Conditions.filter(x => x.Type === 'LOAN_INSTALLMENT'), pay = c.Conditions.find(x => x.Type === 'LOAN_PAYOUT');
    const pend = ins.filter(x => x.Status !== 'FULFILLED');
    const ia = x => x.TotalAmount && x.TotalAmount.Amount ? x.TotalAmount.Amount : (x.TotalAmount || x.RepaymentAmount || 0);
    const nextDue = pend.map(x => x.DeadlineEpochMs).filter(Boolean).sort()[0] || null;
    return { id: c.ContractLocalId, partner: c.PartnerName, st: c.Status, since: c.DateEpochMs, principal: pay ? amt(pay) : null,
      n: ins.length, paid: ins.length - pend.length, inst: ins[0] ? ia(ins[0]) : null, pendingTotal: r0(pend.reduce((a, x) => a + ia(x), 0)), nextDue };
  }).filter(l => l.pendingTotal > 0);
  const payments = cons.filter(c => ['CLOSED', 'PARTIALLY_FULFILLED'].includes(c.Status)).flatMap(c => c.Conditions.filter(x => x.Type === 'PAYMENT' && x.Status !== 'FULFILLED' && x.Party === c.Party)
    .map(x => ({ id: c.ContractLocalId, partner: c.PartnerName, name: c.Name, amt: r0(amt(x)), due: x.DeadlineEpochMs || null })));
  const used = new Set(); sites.forEach(s => s.Buildings.forEach(b => used.add(b.BuildingTicker)));
  const recipes = recs.filter(r => used.has(r.BuildingTicker)).map(r => ({ b: r.BuildingTicker, n: r.RecipeName, h: r2(r.TimeMs / 3.6e6), i: Object.fromEntries((r.Inputs || []).map(x => [x.Ticker, x.Amount])), o: Object.fromEntries((r.Outputs || []).map(x => [x.Ticker, x.Amount])) }));
  recipes.forEach(r => Object.keys(r.i).concat(Object.keys(r.o)).forEach(t => pxT.add(t)));
  BOMT.forEach(t => pxT.add(t));
  const book = {}; await Promise.all(BOMT.map(async t => { try { const x = await fetch('https://rest.fnar.net/exchange/' + t + '.CI1').then(r => r.json()); const m = {}; (x.SellingOrders || []).forEach(o => { if (o.ItemCost) m[o.ItemCost] = (m[o.ItemCost] || 0) + (o.ItemCount == null ? 1e9 : o.ItemCount); }); book[t] = Object.entries(m).map(([p, n]) => [+p, n]).sort((a, b) => a[0] - b[0]).slice(0, 8); } catch (e) {} }));
  const px = {}; pxT.forEach(t => { const x = P[t]; if (x) px[t] = [x.Ask, x.Bid, x.VWAP7D, x.AverageTraded7D == null ? null : r2(x.AverageTraded7D)]; });
  const cis = user.Balances.find(b => b.Currency === 'CIS');
  const T = x => x ? new Date(x).getTime() : null;
  const fresh = { ships: Object.fromEntries(ships.map(s => [s.Registration, { f: T((flights.find(x => x.FlightId === s.FlightId) || {}).Timestamp), c: T((storage.find(x => x.StorageId === s.StoreId) || {}).Timestamp) }])), bases: Object.fromEntries(Object.entries(baseStore).map(([k, v]) => [k, T(v.Timestamp)])), wh: T((storage.find(s => s.Type === 'WAREHOUSE_STORE') || {}).Timestamp) };
  return { v: 2, fresh, t: now, cashFio: cis ? r0(cis.Amount) : null, val: Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, r0(v)])), split: { S: r0(sp.S), P: r0(sp.P), O: r0(sp.O) },
    bases, warehouses, ships: shipRows, orders, trades, loans, payments, recipes, px, book };
}

module.exports = { opsSnapshot };
