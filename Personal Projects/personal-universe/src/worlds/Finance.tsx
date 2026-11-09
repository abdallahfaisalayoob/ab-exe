// Finance — where your money stands. Every figure is computed from entries you made;
// the only forward-looking numbers are labelled projections with their rule stated.
import { useMemo, useState } from "react";
import { batch, call, log, native, q, run } from "../lib/backend";
import { MONTHS, daysUntil, fmtDate, monthKey, parseLocal, relDay, today } from "../lib/dates";
import { CATEGORIES, advance, balances, byCategory, categoryMatrix, convert, dailySpend, mapStatement, monthlyEquivalent, monthlyFlow, monthsBack, needsRate, netWorth, netWorthSeries, project, type Account, type Recurring, type Tx } from "../lib/finance";
import { PALETTE, money, plural } from "../lib/format";
import { useIntent, useQ, useRows, useSetting } from "../lib/hooks";
import { ask, attempt, toast, useUI } from "../lib/store";
import { Icon } from "../ui/Icons";
import { Donut, Heatmap, LineChart, PairBars, useTip } from "../ui/charts";
import { Confirm, Empty, Field, Modal, Ring, Seg, Stat, Tabs } from "../ui/kit";

type Tab = "overview" | "transactions" | "accounts" | "budgets" | "goals" | "recurring";
const ml = (m: string) => MONTHS[+m.slice(5) - 1].slice(0, 3);
const KINDS: Record<string, string> = { cash: "Cash", bank: "Bank account", asset: "Asset", liability: "Liability" };

export default function Finance() {
  const set = useUI((s) => s.set);
  const [tab, setTab] = useState<Tab>("overview");
  const [acctForm, setAcctForm] = useState<any>(null);
  const [base, setBase] = useSetting("currency", "PKR");
  const [rate] = useSetting("usdRate", 0);
  useIntent("finance", (i) => { if (i.tab) setTab(i.tab as Tab); if (i.action === "new") setAcctForm({}); });
  const data = useQ(async () => ({ accounts: await q<Account>("SELECT * FROM accounts ORDER BY archived, kind = 'liability', id"), txs: await q<Tx>("SELECT * FROM transactions ORDER BY date DESC, id DESC") }), []).data;
  if (!data) return null;
  const { accounts, txs } = data;
  const props = { accounts, txs, base, rate };
  return (
    <>
      <div className="world-head">
        <div><h1 className="display">Finance</h1><p className="sub">A private ledger for income, spending, assets and goals. Stored only on this computer.</p></div>
        <div className="row"><Seg value={base} onChange={setBase} options={[{ value: "PKR", label: "PKR" }, { value: "USD", label: "USD" }]} /><button className="btn" onClick={() => setAcctForm({})}><Icon name="plus" size={14} />Account</button><button className="btn primary" onClick={() => set({ quick: { type: "tx" } })}><Icon name="wallet" size={14} />Transaction</button></div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "overview", label: "Overview" }, { id: "transactions", label: "Transactions", count: txs.length }, { id: "accounts", label: "Accounts & assets" }, { id: "budgets", label: "Budgets" }, { id: "goals", label: "Savings goals" }, { id: "recurring", label: "Recurring & subscriptions" }]} />
      <div className="world-body">
        {needsRate(accounts, base, rate) && <button className="plate row small" style={{ padding: "10px 14px", marginBottom: 16, width: "100%", textAlign: "left", borderColor: "color-mix(in srgb, var(--warn) 45%, transparent)" }} onClick={() => set({ settings: true })}><Icon name="warn" size={15} style={{ color: "var(--warn)" }} />Some accounts are not in {base}. They are left out of totals until you enter a USD → PKR rate in Settings — no rate is assumed or fetched.</button>}
        {accounts.length === 0 ? <Empty icon="wallet" title="Start with one account" action={<button className="btn primary" onClick={() => setAcctForm({})}>Add an account</button>}>A wallet, a bank account, savings, something you own or something you owe. Enter what it holds today and record from there — or import a CSV/Excel statement afterwards. Nothing is pre-filled.</Empty>
          : tab === "overview" ? <Overview {...props} />
          : tab === "transactions" ? <Transactions {...props} />
          : tab === "accounts" ? <Accounts {...props} edit={setAcctForm} />
          : tab === "budgets" ? <Budgets {...props} />
          : tab === "goals" ? <Goals base={base} />
          : <RecurringTab accounts={accounts} base={base} rate={rate} />}
      </div>
      {acctForm && <AccountForm init={acctForm} onClose={() => setAcctForm(null)} />}
    </>
  );
}
interface P { accounts: Account[]; txs: Tx[]; base: string; rate: number }

function Overview({ accounts, txs, base, rate }: P) {
  const now = new Date();
  const m12 = monthsBack(12), m6 = m12.slice(6);
  const [month, setMonth] = useState(m12[11]);
  const nw = netWorth(accounts, txs, base, rate);
  const flows = monthlyFlow(accounts, txs, base, rate, m6);
  const cur = flows[5], prev = flows[4];
  const first = [...txs].map((t) => t.date.slice(0, 7)).concat(accounts.map((a) => a.opened_on.slice(0, 7))).sort()[0] ?? m12[11];
  const months = m12.filter((m) => m >= first);
  const series = netWorthSeries(accounts, txs, base, rate, months);
  const proj = project(accounts, txs, base, rate, 6, now);
  const cats = byCategory(accounts, txs, base, rate, month);
  const catTotal = cats.reduce((s, c) => s + c.total, 0);
  const matrix = categoryMatrix(accounts, txs, base, rate, m6);
  const daily = dailySpend(accounts, txs, base, rate, month);
  const fmt = (n: number) => money(n, base, { compact: true });
  const labels = [...months.map(ml), ...(proj.ok ? proj.points.slice(1).map((p) => ml(p.month)) : [])];
  const tip = useTip();
  const daysIn = new Date(+month.slice(0, 4), +month.slice(5), 0).getDate(), lead = (new Date(+month.slice(0, 4), +month.slice(5) - 1, 1).getDay() + 6) % 7, dmax = Math.max(1, ...daily.values());
  return (
    <div className="col gap6">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 28 }}>
        <Stat label="Net worth" value={money(nw.net, base)} sub={`${fmt(nw.assets)} owned · ${fmt(nw.liabilities)} owed`} />
        <Stat label={`${MONTHS[now.getMonth()]} — money in`} value={fmt(cur.income)} tone="good" sub={prev.income ? `${fmt(prev.income)} last month` : "no income recorded last month"} />
        <Stat label={`${MONTHS[now.getMonth()]} — money out`} value={fmt(cur.expense)} sub={prev.expense ? `${cur.expense >= prev.expense ? "+" : "−"}${Math.abs(Math.round((cur.expense / prev.expense - 1) * 100))}% vs last month so far` : "no spending recorded last month"} />
        <Stat label="Runway" value={proj.runwayMonths != null ? `${proj.runwayMonths.toFixed(1)} mo` : "—"} sub={proj.runwayMonths != null ? `${fmt(nw.liquid)} in cash & bank ÷ ${fmt(proj.avgExpense)} average monthly spending` : "Needs one complete month of spending"} />
      </div>

      <div className="plate pad lit">
        <div className="section-head"><span className="label">Net-worth timeline{proj.ok ? " · with projection" : ""}</span><span className="small faint">{proj.ok ? `Dashed line: your average net of ${money(proj.avgNet, base, { compact: true, sign: true })}/month over ${proj.basisMonths.map(ml).join(", ")}, carried forward. A rule, not a forecast.` : proj.reason}</span></div>
        <LineChart height={240} format={fmt} labels={labels} zero={false} series={[
          { label: "Net worth", color: "var(--hue-finance)", values: [...series.map((p) => p.value), ...(proj.ok ? proj.points.slice(1).map(() => NaN) : [])] },
          ...(proj.ok ? [{ label: "Projected", color: "var(--ink-3)", dashed: true, values: [...series.slice(0, -1).map(() => NaN), ...proj.points.map((p) => p.value)] }] : []),
        ]} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div className="plate pad"><div className="section-head"><span className="label">Income vs expenditure</span><span className="row gap3 small faint"><span className="row gap1"><i className="dot" style={{ "--c": "var(--hue-finance)" } as any} />in</span><span className="row gap1"><i className="dot" style={{ "--c": "var(--hue-projects)" } as any} />out</span></span></div>
          <PairBars data={flows.map((f) => ({ label: ml(f.month), a: f.income, b: f.expense }))} colors={["var(--hue-finance)", "var(--hue-projects)"]} names={["Income", "Spending"]} format={fmt} /></div>
        <div className="plate pad"><div className="section-head"><span className="label">Where it went</span><select className="select" style={{ width: 130, height: 28 }} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">{[...m12].reverse().map((m) => <option key={m} value={m}>{ml(m)} {m.slice(0, 4)}</option>)}</select></div>
          {cats.length === 0 ? <p className="small faint" style={{ padding: "60px 0", textAlign: "center" }}>No spending recorded in {ml(month)}.</p> : (
            <div className="row gap5"><Donut data={cats.map((c, i) => ({ label: c.category, value: c.total, color: PALETTE[i % PALETTE.length] }))} format={(n) => money(n, base)} center={<div><div className="display num" style={{ fontSize: 24 }}>{fmt(catTotal)}</div><div className="label" style={{ fontSize: 9 }}>spent</div></div>} />
              <div className="col grow" style={{ gap: 5 }}>{cats.slice(0, 7).map((c, i) => <div key={c.category} className="row small"><i className="dot" style={{ "--c": PALETTE[i % PALETTE.length] } as any} /><span className="grow truncate">{c.category}</span><span className="num">{money(c.total, base)}</span><span className="faint num" style={{ width: 34, textAlign: "right" }}>{Math.round((c.total / catTotal) * 100)}%</span></div>)}{cats.length > 7 && <span className="small faint">+ {cats.length - 7} smaller categories</span>}</div></div>)}
        </div>
        <div className="plate pad"><div className="section-head"><span className="label">Category heatmap · last six months</span></div>
          {matrix.cats.length ? <Heatmap rows={matrix.cats.slice(0, 9)} cols={m6.map(ml)} cells={matrix.cells.slice(0, 9)} max={matrix.max} color="var(--hue-finance)" format={(n) => money(n, base)} /> : <p className="small faint">Spending by category will build up here month by month.</p>}</div>
        <div className="plate pad"><div className="section-head"><span className="label">Daily cash-flow · {ml(month)} {month.slice(0, 4)}</span><span className="small faint">darker = more spent that day</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5 }}>
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i} className="label" style={{ textAlign: "center", fontSize: 9 }}>{d}</span>)}
            {Array.from({ length: lead }, (_, i) => <span key={"l" + i} />)}
            {Array.from({ length: daysIn }, (_, i) => { const key = `${month}-${String(i + 1).padStart(2, "0")}`, v = daily.get(key) ?? 0; return <div key={key} onMouseMove={(e) => tip.show(e, <span>{fmtDate(key)} · <b>{v ? money(v, base) : "nothing spent"}</b></span>)} onMouseLeave={tip.hide} style={{ height: 30, borderRadius: 7, display: "grid", placeItems: "center", fontSize: 10, color: v / dmax > 0.5 ? "#0B0D12" : "var(--ink-3)", background: v ? `color-mix(in srgb, var(--hue-projects) ${Math.round(14 + 80 * Math.sqrt(v / dmax))}%, transparent)` : "var(--plate)", border: key === today() ? "1px solid var(--ink-2)" : "1px solid var(--line)" }} className="mono">{i + 1}</div>; })}
          </div>{tip.node}</div>
      </div>
    </div>
  );
}

function Transactions({ accounts, txs, base, rate }: P) {
  const set = useUI((s) => s.set);
  const [text, setText] = useState(""); const [acct, setAcct] = useState(""); const [cat, setCat] = useState(""); const [month, setMonth] = useState("");
  const [imp, setImp] = useState<any>(null);
  const name = new Map(accounts.map((a) => [a.id, a]));
  const list = txs.filter((t) => (!acct || t.account_id === +acct) && (!cat || t.category === cat) && (!month || t.date.startsWith(month)) && (!text || (t.payee + t.note + t.category).toLowerCase().includes(text.toLowerCase())));
  const cats = [...new Set(txs.map((t) => t.category))].sort(), months = [...new Set(txs.map((t) => t.date.slice(0, 7)))];
  const sum = (f: (t: Tx) => boolean) => list.filter((t) => t.transfer_id == null && f(t)).reduce((s, t) => s + convert(t.amount, name.get(t.account_id)?.currency ?? base, base, rate), 0);
  const pick = () => attempt(async () => {
    const [path] = await native.pick("sheet");
    if (!path) return;
    const sheets = await call<any[]>("grid.read", { path });
    const r = mapStatement(sheets[0]?.rows ?? []);
    if (!r.ok) throw new Error(r.error);
    setImp({ rows: r.rows, skipped: r.skipped, file: path.split(/[\\/]/).pop(), account: String(accounts.find((a) => !a.archived)?.id ?? "") });
  });
  const doImport = () => attempt(async () => {
    const id = +imp.account, have = new Set(txs.filter((t) => t.account_id === id).map((t) => `${t.date}|${t.amount}|${t.payee}`));
    const fresh = imp.rows.filter((r: any) => !have.has(`${r.date}|${r.amount}|${r.payee}`));
    await batch(fresh.map((r: any) => ({ sql: "INSERT INTO transactions(account_id, date, amount, category, payee, note, created_at) VALUES(?,?,?,?,?,?,?)", params: [id, r.date, r.amount, r.category, r.payee, "Imported from " + imp.file, Date.now()] })));
    void log("finance", "import", `Imported ${plural(fresh.length, "transaction")}`, undefined, imp.file);
    toast(`${plural(fresh.length, "transaction")} imported${imp.rows.length - fresh.length ? `, ${imp.rows.length - fresh.length} already present and skipped` : ""}.`, "good");
    setImp(null);
  });
  return (
    <div className="col gap4">
      <div className="row wrap gap3">
        <input className="input" style={{ width: 220 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Search payee, note, category…" />
        <select className="select" style={{ width: 170 }} value={acct} onChange={(e) => setAcct(e.target.value)} aria-label="Account"><option value="">All accounts</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <select className="select" style={{ width: 170 }} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option value="">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>
        <select className="select" style={{ width: 130 }} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month"><option value="">All time</option>{months.map((m) => <option key={m} value={m}>{ml(m)} {m.slice(0, 4)}</option>)}</select>
        <span className="grow" /><span className="small dim num"><span className="good">{money(sum((t) => t.amount > 0), base)}</span> in · {money(-sum((t) => t.amount < 0), base)} out</span>
        <button className="btn" onClick={pick}><Icon name="upload" size={14} />Import CSV / Excel</button>
      </div>
      {list.length === 0 ? <Empty icon="wallet" title={txs.length ? "No transactions match" : "No transactions yet"} action={!txs.length ? <button className="btn primary" onClick={() => set({ quick: { type: "tx" } })}>Record the first one</button> : undefined}>Record them by hand (Ctrl E), type “spent 450 on lunch” into the command bar, or import a bank statement.</Empty> : (
        <div className="plate" style={{ overflow: "hidden" }}><table className="table"><thead><tr><th>Date</th><th>Payee / source</th><th>Category</th><th>Account</th><th className="r">Amount</th></tr></thead>
          <tbody>{list.slice(0, 400).map((t) => { const a = name.get(t.account_id); return (
            <tr key={t.id} style={{ cursor: "pointer" }} onClick={() => t.transfer_id == null && set({ quick: { type: "tx", init: { id: t.id } } })}>
              <td className="faint num" style={{ whiteSpace: "nowrap" }}>{fmtDate(t.date)}</td><td><span>{t.payee || <span className="faint">—</span>}</span>{t.note && <span className="small faint"> · {t.note}</span>}</td>
              <td><span className="chip">{t.category}</span></td><td className="dim">{a?.name}</td>
              <td className={"r num " + (t.transfer_id != null ? "faint" : t.amount > 0 ? "good" : "")} style={{ whiteSpace: "nowrap" }}>{money(t.amount, a?.currency, { sign: true })}{t.transfer_id != null && <Confirm onConfirm={() => run("DELETE FROM transactions WHERE transfer_id = ?", [t.transfer_id!])} label="Delete transfer" />}</td>
            </tr>); })}</tbody></table>{list.length > 400 && <p className="small faint" style={{ padding: 12 }}>Showing the latest 400 of {list.length}. Narrow the filters to see older entries.</p>}</div>)}
      {imp && <Modal title="Import statement" sub={imp.file} onClose={() => setImp(null)} wide foot={<><button className="btn ghost" onClick={() => setImp(null)}>Cancel</button><button className="btn primary" onClick={doImport}>Import {imp.rows.length} rows</button></>}>
        <div className="row gap4"><Field label="Into account"><select className="select" style={{ width: 240 }} value={imp.account} onChange={(e) => setImp({ ...imp, account: e.target.value })}>{accounts.filter((a) => !a.archived).map((a) => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}</select></Field><span className="small faint grow">{plural(imp.rows.length, "row")} read{imp.skipped ? ` · ${plural(imp.skipped, "row")} without a readable date or amount will be left out` : ""}. Rows already in this account (same date, amount and payee) are skipped. Amounts are taken exactly as written, in the account's currency.</span></div>
        <div className="scroll plate" style={{ maxHeight: 320 }}><table className="table"><thead><tr><th>Date</th><th>Payee</th><th>Category</th><th className="r">Amount</th></tr></thead><tbody>{imp.rows.slice(0, 80).map((r: any, i: number) => <tr key={i}><td className="num faint">{r.date}</td><td>{r.payee}</td><td>{r.category}</td><td className={"r num " + (r.amount > 0 ? "good" : "")}>{r.amount.toLocaleString()}</td></tr>)}</tbody></table></div>
      </Modal>}
    </div>
  );
}

function Accounts({ accounts, txs, base, rate, edit }: P & { edit: (a: any) => void }) {
  const bal = balances(accounts, txs);
  const revalue = async (a: Account) => { const cur = bal.get(a.id) ?? 0; const v = await ask(`Current value of “${a.name}” in ${a.currency}`, String(cur)); const n = v == null ? NaN : parseFloat(v.replace(/,/g, "")); if (Number.isFinite(n) && n !== cur) void run("INSERT INTO transactions(account_id, date, amount, category, note, created_at) VALUES(?,?,?,?,?,?)", [a.id, today(), n - cur, "Valuation", "Value updated", Date.now()]); };
  return (
    <div className="col gap5">{(["cash", "bank", "asset", "liability"] as const).map((k) => { const list = accounts.filter((a) => a.kind === k); if (!list.length) return null; const total = list.filter((a) => !a.archived).reduce((s, a) => s + convert(bal.get(a.id) ?? 0, a.currency, base, rate), 0); return (
      <section key={k}><div className="section-head"><span className="label">{KINDS[k]}{k === "bank" ? "s" : k === "asset" ? "s" : k === "liability" ? "" : ""}</span><span className="small dim num">{money(total, base)}</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>{list.map((a) => { const b = bal.get(a.id) ?? 0; return (
          <div key={a.id} className="plate hover col" style={{ padding: 16, gap: 6, opacity: a.archived ? 0.5 : 1 }}>
            <div className="row between"><b className="truncate">{a.name}</b><span className="chip">{a.currency}{a.archived ? " · archived" : ""}</span></div>
            <span className={"display num " + (b < 0 ? "bad" : "")} style={{ fontSize: 30 }}>{money(b, a.currency)}</span>
            <span className="small faint">{txs.filter((t) => t.account_id === a.id).length} entries · since {fmtDate(a.opened_on)}{a.currency !== base && rate ? ` · ≈ ${money(convert(b, a.currency, base, rate), base)}` : ""}</span>
            <div className="row gap1" style={{ marginTop: 6 }}><button className="btn sm ghost" onClick={() => edit(a)}><Icon name="edit" size={12} />Edit</button>{(k === "asset" || k === "liability") && <button className="btn sm ghost" onClick={() => revalue(a)}><Icon name="repeat" size={12} />Update value</button>}<button className="btn sm ghost" onClick={() => run("UPDATE accounts SET archived = 1 - archived WHERE id = ?", [a.id])}>{a.archived ? "Restore" : "Archive"}</button></div>
          </div>); })}</div>
      </section>); })}</div>
  );
}

function AccountForm({ init, onClose }: { init: any; onClose: () => void }) {
  const [f, setF] = useState({ name: "", kind: "bank", currency: "PKR", opened_on: today(), ...init, opening: init.id ? String(init.kind === "liability" ? -init.opening_balance : init.opening_balance) : "" });
  const set = (p: any) => setF({ ...f, ...p });
  const save = () => attempt(async () => {
    if (!f.name.trim()) throw new Error("Name the account.");
    const n = parseFloat(f.opening || "0"); if (!Number.isFinite(n)) throw new Error("The balance must be a number.");
    const opening = f.kind === "liability" ? -Math.abs(n) : n;
    if (f.id) await run("UPDATE accounts SET name=?, kind=?, currency=?, opening_balance=?, opened_on=? WHERE id=?", [f.name.trim(), f.kind, f.currency, opening, f.opened_on, f.id]);
    else { const r = await run("INSERT INTO accounts(name, kind, currency, opening_balance, opened_on) VALUES(?,?,?,?,?)", [f.name.trim(), f.kind, f.currency, opening, f.opened_on]); void log("finance", "account", `Added account ${f.name.trim()}`, { type: "account", id: r.lastId }); }
    onClose();
  });
  return (
    <Modal title={f.id ? "Edit account" : "New account"} onClose={onClose} foot={<>{f.id && <Confirm className="btn ghost danger" label="Delete with its transactions" onConfirm={() => attempt(async () => { await run("DELETE FROM accounts WHERE id = ?", [f.id]); onClose(); })} />}<span className="grow" /><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <Field label="Name"><input className="input" autoFocus value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Wallet, Meezan current account, Laptop, Loan from Ali" /></Field>
      <Field label="Type"><Seg value={f.kind} onChange={(v) => set({ kind: v })} options={Object.entries(KINDS).map(([value, label]) => ({ value, label }))} /></Field>
      <div className="grid3">
        <Field label="Currency"><select className="select" value={f.currency} onChange={(e) => set({ currency: e.target.value })}><option>PKR</option><option>USD</option></select></Field>
        <Field label={f.kind === "liability" ? "Amount owed" : f.kind === "asset" ? "Value" : "Balance"}><input className="input num" type="number" step="any" value={f.opening} onChange={(e) => set({ opening: e.target.value })} placeholder="0" /></Field>
        <Field label="As of"><input className="input" type="date" value={f.opened_on} onChange={(e) => set({ opened_on: e.target.value })} /></Field>
      </div>
      <p className="small faint">This is the starting point. Transactions you record after this date move the balance from here.</p>
    </Modal>
  );
}

function Budgets({ accounts, txs, base, rate }: P) {
  const budgets = useRows<any>("SELECT * FROM budgets ORDER BY category");
  const month = monthKey(new Date()), spent = byCategory(accounts, txs, base, rate, month);
  const [cat, setCat] = useState(""); const [limit, setLimit] = useState("");
  const add = () => attempt(async () => { const n = parseFloat(limit); if (!cat.trim() || !(n > 0)) throw new Error("Choose a category and a monthly limit."); await run("INSERT INTO budgets(category, monthly_limit, currency) VALUES(?,?,?) ON CONFLICT(category) DO UPDATE SET monthly_limit = excluded.monthly_limit, currency = excluded.currency", [cat.trim(), n, base]); setCat(""); setLimit(""); });
  const now = new Date(), frac = now.getDate() / new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return (
    <div className="col gap4" style={{ maxWidth: 860 }}>
      <div className="row gap3"><input className="input" style={{ width: 220 }} list="pu-bcats" value={cat} onChange={(e) => setCat(e.target.value)} placeholder="Category" /><datalist id="pu-bcats">{[...new Set([...spent.map((s) => s.category), ...CATEGORIES])].map((c) => <option key={c} value={c} />)}</datalist><input className="input num" style={{ width: 170 }} type="number" min="0" value={limit} onChange={(e) => setLimit(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder={`Monthly limit (${base})`} /><button className="btn primary" onClick={add}>Set budget</button><span className="small faint">{MONTHS[now.getMonth()]} is {Math.round(frac * 100)}% through.</span></div>
      {budgets.length === 0 ? <Empty icon="target" title="No budgets set">A budget is a monthly ceiling for one category. You will see how much of it is used, and whether you are ahead of the month's pace.</Empty> : budgets.map((b) => { const lim = convert(b.monthly_limit, b.currency, base, rate), s = spent.find((x) => x.category === b.category)?.total ?? 0, ratio = lim ? s / lim : 0; return (
        <div key={b.id} className="plate" style={{ padding: "14px 16px" }}>
          <div className="row between"><b>{b.category}</b><div className="row"><span className="small num">{money(s, base)} <span className="faint">of {money(lim, base)}</span></span><Confirm onConfirm={() => run("DELETE FROM budgets WHERE id = ?", [b.id])} /></div></div>
          <div className="bar" style={{ margin: "10px 0 6px", height: 7, position: "relative", overflow: "visible" }}><i style={{ width: `${Math.min(100, ratio * 100)}%`, "--c": ratio > 1 ? "var(--bad)" : ratio > frac + 0.1 ? "var(--warn)" : "var(--good)" } as any} /><span style={{ position: "absolute", left: `${frac * 100}%`, top: -3, bottom: -3, width: 1.5, background: "var(--ink-2)" }} title="Today's position in the month" /></div>
          <span className={"small " + (ratio > 1 ? "bad" : "faint")}>{ratio > 1 ? `Over by ${money(s - lim, base)}` : ratio > frac + 0.1 ? `Ahead of the month's pace — ${money(lim - s, base)} left` : `${money(lim - s, base)} left`}</span>
        </div>); })}
    </div>
  );
}

function Goals({ base }: { base: string }) {
  const goals = useRows<any>("SELECT * FROM goals WHERE kind = 'savings' ORDER BY done, due_date IS NULL, due_date");
  const [form, setForm] = useState<any>(null);
  const save = () => attempt(async () => { const t = parseFloat(form.target_amount); if (!form.title.trim() || !(t > 0)) throw new Error("A goal needs a name and a target amount."); const p = [form.title.trim(), t, parseFloat(form.saved_amount) || 0, form.currency, form.due_date || null]; if (form.id) await run("UPDATE goals SET title=?, target_amount=?, saved_amount=?, currency=?, due_date=? WHERE id=?", [...p, form.id]); else await run("INSERT INTO goals(title, kind, target_amount, saved_amount, currency, due_date, created_at) VALUES(?, 'savings', ?,?,?,?,?)", [...p, Date.now()]); setForm(null); });
  const add = async (g: any) => { const v = await ask(`Add to “${g.title}” (${g.currency}) — use a minus sign to take money out`); const n = v == null ? NaN : parseFloat(v.replace(/,/g, "")); if (Number.isFinite(n) && n) { const s = Math.max(0, g.saved_amount + n); void run("UPDATE goals SET saved_amount = ?, done = ?, done_at = ? WHERE id = ?", [s, s >= g.target_amount ? 1 : 0, s >= g.target_amount ? Date.now() : null, g.id]); if (s >= g.target_amount) void log("finance", "goal", `Reached savings goal: ${g.title}`); } };
  return (
    <div className="col gap4">
      <div className="row between"><span className="small faint" style={{ maxWidth: 620 }}>Goals track what you have set aside. You update them yourself — they are not tied to an account, so nothing moves automatically.</span><button className="btn primary" onClick={() => setForm({ title: "", target_amount: "", saved_amount: "", currency: base, due_date: "" })}><Icon name="target" size={14} />New goal</button></div>
      {goals.length === 0 ? <Empty icon="target" title="No savings goals yet">A laptop, a trip, an emergency fund. Set a target and an optional date, and see what it takes each month to get there.</Empty> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>{goals.map((g) => { const ratio = g.saved_amount / g.target_amount, left = g.target_amount - g.saved_amount, months = g.due_date ? Math.max(1, Math.ceil(daysUntil(g.due_date) / 30.4)) : null; return (
          <div key={g.id} className="plate lit row gap4" style={{ padding: 18 }}>
            <Ring value={ratio} size={78} stroke={6} color={g.done ? "var(--good)" : "var(--hue)"} />
            <div className="col grow" style={{ gap: 3 }}><b className="truncate">{g.title}</b><span className="num">{money(g.saved_amount, g.currency)} <span className="faint">of {money(g.target_amount, g.currency)}</span></span>
              <span className="small faint">{g.done ? "Reached" : g.due_date ? (daysUntil(g.due_date) < 0 ? `Target date passed ${relDay(g.due_date)}` : `${money(left / months!, g.currency)} a month for ${months} mo reaches it by ${fmtDate(g.due_date)}`) : `${money(left, g.currency)} to go`}</span>
              <div className="row gap1" style={{ marginTop: 6 }}><button className="btn sm" onClick={() => add(g)}><Icon name="plus" size={12} />Add</button><button className="btn sm ghost" onClick={() => setForm({ ...g, due_date: g.due_date ?? "" })}>Edit</button><Confirm onConfirm={() => run("DELETE FROM goals WHERE id = ?", [g.id])} /></div></div>
          </div>); })}</div>)}
      {form && <Modal title={form.id ? "Edit goal" : "New savings goal"} onClose={() => setForm(null)} foot={<><button className="btn ghost" onClick={() => setForm(null)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
        <Field label="What are you saving for?"><input className="input" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <div className="grid2"><Field label="Target"><input className="input num" type="number" min="0" value={form.target_amount} onChange={(e) => setForm({ ...form, target_amount: e.target.value })} /></Field><Field label="Saved so far"><input className="input num" type="number" min="0" value={form.saved_amount} onChange={(e) => setForm({ ...form, saved_amount: e.target.value })} /></Field>
          <Field label="Currency"><select className="select" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}><option>PKR</option><option>USD</option></select></Field><Field label="Target date (optional)"><input className="input" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field></div>
      </Modal>}
    </div>
  );
}

function RecurringTab({ accounts, base, rate }: { accounts: Account[]; base: string; rate: number }) {
  const rows = useRows<Recurring>("SELECT * FROM recurring ORDER BY active DESC, next_date");
  const [form, setForm] = useState<any>(null);
  const live = accounts.filter((a) => !a.archived);
  const out = rows.filter((r) => r.active && r.amount < 0), subs = out.filter((r) => r.is_subscription);
  const mo = (list: Recurring[]) => list.reduce((s, r) => s + convert(Math.abs(monthlyEquivalent(r.amount, r.cadence)), r.currency, base, rate), 0);
  const save = () => attempt(async () => { const n = parseFloat(form.amount); if (!form.title.trim() || !(n > 0)) throw new Error("A recurring item needs a name and an amount."); const p = [form.title.trim(), form.income ? n : -n, form.currency, form.category || (form.is_subscription ? "Subscriptions" : "Uncategorised"), form.account_id ? +form.account_id : null, form.cadence, form.next_date, form.is_subscription ? 1 : 0]; if (form.id) await run("UPDATE recurring SET title=?, amount=?, currency=?, category=?, account_id=?, cadence=?, next_date=?, is_subscription=? WHERE id=?", [...p, form.id]); else await run("INSERT INTO recurring(title, amount, currency, category, account_id, cadence, next_date, is_subscription) VALUES(?,?,?,?,?,?,?,?)", p); setForm(null); });
  const post = (r: Recurring) => attempt(async () => { const acct = live.find((a) => a.id === r.account_id) ?? live.find((a) => a.currency === r.currency); if (!acct) throw new Error(`No ${r.currency} account to post this to.`); await batch([{ sql: "INSERT INTO transactions(account_id, date, amount, category, payee, recurring_id, created_at) VALUES(?,?,?,?,?,?,?)", params: [acct.id, r.next_date > today() ? today() : r.next_date, r.amount, r.category, r.title, r.id, Date.now()] }, { sql: "UPDATE recurring SET next_date = ? WHERE id = ?", params: [advance(r.next_date, r.cadence), r.id] }]); }, `Recorded ${r.title}; next on ${fmtDate(advance(r.next_date, r.cadence))}.`);
  return (
    <div className="col gap5">
      <div className="row between gap5" style={{ alignItems: "flex-end" }}>
        <div className="row gap6"><Stat label="Committed each month" value={money(mo(out), base)} sub={`${plural(out.length, "recurring payment")}`} /><Stat label="Subscriptions per year" value={money(mo(subs) * 12, base)} sub={`${plural(subs.length, "subscription")} · ${money(mo(subs), base)}/month`} /></div>
        <button className="btn primary" onClick={() => setForm({ title: "", amount: "", currency: base, category: "", account_id: "", cadence: "monthly", next_date: today(), is_subscription: true, income: false })}><Icon name="repeat" size={14} />New recurring item</button>
      </div>
      {rows.length === 0 ? <Empty icon="repeat" title="Nothing recurring yet">Rent, fees, phone packages, streaming. Personal Universe reminds you when one is due; a transaction is only recorded when you press “Record”, so the ledger never fills itself in.</Empty> : (
        <div className="plate" style={{ padding: 6 }}>{rows.map((r) => { const n = daysUntil(r.next_date); return (
          <div key={r.id} className="list-row" style={{ opacity: r.active ? 1 : 0.45 }}>
            <Icon name={r.is_subscription ? "repeat" : "calendar"} size={16} style={{ color: "var(--hue)", flex: "none" }} />
            <div className="col grow" style={{ gap: 0 }}><span>{r.title}</span><span className="small faint">{r.category} · {r.cadence}{r.cadence !== "monthly" ? ` · ≈ ${money(Math.abs(monthlyEquivalent(r.amount, r.cadence)), r.currency)}/month` : ""}</span></div>
            <span className={"num " + (r.amount > 0 ? "good" : "")}>{money(r.amount, r.currency, { sign: true })}</span>
            <span className={"small " + (n <= 0 ? "warn" : "faint")} style={{ width: 120, textAlign: "right" }}>{fmtDate(r.next_date)} · {relDay(r.next_date)}</span>
            <button className="btn sm" onClick={() => post(r)} disabled={!r.active}>Record</button>
            <button className="icon-btn sm" title="Edit" onClick={() => setForm({ ...r, amount: String(Math.abs(r.amount)), income: r.amount > 0, account_id: r.account_id ?? "" })}><Icon name="edit" size={14} /></button>
            <button className="icon-btn sm" title={r.active ? "Pause" : "Resume"} onClick={() => run("UPDATE recurring SET active = 1 - active WHERE id = ?", [r.id])}><Icon name={r.active ? "min" : "play"} size={14} /></button>
            <Confirm onConfirm={() => run("DELETE FROM recurring WHERE id = ?", [r.id])} />
          </div>); })}</div>)}
      {form && <Modal title={form.id ? "Edit recurring item" : "New recurring item"} onClose={() => setForm(null)} foot={<><button className="btn ghost" onClick={() => setForm(null)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
        <Field label="Name"><input className="input" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Hostel rent, Spotify" /></Field>
        <div className="row gap3"><Seg value={form.income ? "in" : "out"} onChange={(v) => setForm({ ...form, income: v === "in" })} options={[{ value: "out", label: "Payment" }, { value: "in", label: "Income" }]} /><label className="row small dim"><input type="checkbox" checked={!!form.is_subscription} onChange={(e) => setForm({ ...form, is_subscription: e.target.checked })} />Count as a subscription</label></div>
        <div className="grid3"><Field label="Amount"><input className="input num" type="number" min="0" step="any" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field><Field label="Currency"><select className="select" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}><option>PKR</option><option>USD</option></select></Field><Field label="Repeats"><select className="select" value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value })}><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></Field>
          <Field label="Next due"><input className="input" type="date" value={form.next_date} onChange={(e) => setForm({ ...form, next_date: e.target.value })} /></Field><Field label="Category"><input className="input" list="pu-rcats" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /><datalist id="pu-rcats">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist></Field><Field label="Paid from"><select className="select" value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}><option value="">First matching account</option>{live.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field></div>
      </Modal>}
    </div>
  );
}
