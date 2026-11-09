// Finance calculations. Pure functions over rows the user entered — nothing is estimated
// unless it is explicitly labelled a projection, and every projection states its rule.
import { monthKey, parseLocal, ymd } from "./dates";

export interface Account { id: number; name: string; kind: "cash" | "bank" | "asset" | "liability"; currency: string; opening_balance: number; opened_on: string; archived: number }
export interface Tx { id: number; account_id: number; date: string; amount: number; category: string; payee: string; note: string; transfer_id: number | null }
export interface Recurring { id: number; title: string; amount: number; currency: string; category: string; account_id: number | null; cadence: "weekly" | "monthly" | "yearly"; next_date: string; is_subscription: number; active: number }

/** `rate` is PKR per 1 USD, set by the user. Other currencies pass through unchanged. */
export function convert(amount: number, from: string, to: string, rate: number) {
  if (from === to || !rate) return amount;
  if (from === "USD" && to === "PKR") return amount * rate;
  if (from === "PKR" && to === "USD") return amount / rate;
  return amount;
}

/** Categories that move money without being income or spending. */
export const NEUTRAL = new Set(["Transfer", "Valuation", "Opening balance"]);
const flow = (t: Tx) => t.transfer_id == null && !NEUTRAL.has(t.category);

export function balances(accounts: Account[], txs: Tx[]) {
  const map = new Map<number, number>(accounts.map((a) => [a.id, a.opening_balance]));
  for (const t of txs) if (map.has(t.account_id)) map.set(t.account_id, (map.get(t.account_id) as number) + t.amount);
  return map;
}

export function netWorth(accounts: Account[], txs: Tx[], base: string, rate: number) {
  const bal = balances(accounts, txs);
  let assets = 0, liabilities = 0, liquid = 0;
  for (const a of accounts) {
    if (a.archived) continue;
    const v = convert(bal.get(a.id) ?? 0, a.currency, base, rate);
    if (v < 0) liabilities += -v; else assets += v;
    if (a.kind === "cash" || a.kind === "bank") liquid += v;
  }
  return { assets, liabilities, net: assets - liabilities, liquid };
}

export function monthsBack(n: number, from = new Date()) {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(monthKey(new Date(from.getFullYear(), from.getMonth() - i, 1)));
  return out;
}

/** Net worth at the end of each month (the current month shows the balance so far). */
export function netWorthSeries(accounts: Account[], txs: Tx[], base: string, rate: number, months: string[]) {
  const cur = new Map(accounts.map((a) => [a.id, a]));
  return months.map((m) => {
    const end = m + "-31";
    let total = 0;
    for (const a of accounts) if (a.opened_on.slice(0, 7) <= m) total += convert(a.opening_balance, a.currency, base, rate);
    for (const t of txs) { const a = cur.get(t.account_id); if (a && t.date <= end && a.opened_on.slice(0, 7) <= m) total += convert(t.amount, a.currency, base, rate); }
    return { month: m, value: total };
  });
}

export function monthlyFlow(accounts: Account[], txs: Tx[], base: string, rate: number, months: string[]) {
  const cur = new Map(accounts.map((a) => [a.id, a.currency]));
  const map = new Map(months.map((m) => [m, { month: m, income: 0, expense: 0 }]));
  for (const t of txs) {
    const row = map.get(t.date.slice(0, 7));
    if (!row || !flow(t)) continue;
    const v = convert(t.amount, cur.get(t.account_id) ?? base, base, rate);
    if (v >= 0) row.income += v; else row.expense += -v;
  }
  return [...map.values()];
}

export function byCategory(accounts: Account[], txs: Tx[], base: string, rate: number, month?: string) {
  const cur = new Map(accounts.map((a) => [a.id, a.currency]));
  const map = new Map<string, number>();
  for (const t of txs) {
    if (!flow(t) || t.amount >= 0 || (month && t.date.slice(0, 7) !== month)) continue;
    map.set(t.category, (map.get(t.category) ?? 0) + -convert(t.amount, cur.get(t.account_id) ?? base, base, rate));
  }
  return [...map.entries()].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total);
}

/** Spending per category per month — the matrix behind the heatmap. */
export function categoryMatrix(accounts: Account[], txs: Tx[], base: string, rate: number, months: string[]) {
  const cats = byCategory(accounts, txs.filter((t) => months.includes(t.date.slice(0, 7))), base, rate).map((c) => c.category);
  const cells = cats.map((c) => months.map((m) => byCategory(accounts, txs.filter((t) => t.category === c), base, rate, m)[0]?.total ?? 0));
  return { cats, months, cells, max: Math.max(0, ...cells.flat()) };
}

export function dailySpend(accounts: Account[], txs: Tx[], base: string, rate: number, month: string) {
  const cur = new Map(accounts.map((a) => [a.id, a.currency]));
  const map = new Map<string, number>();
  for (const t of txs) if (flow(t) && t.amount < 0 && t.date.startsWith(month)) map.set(t.date, (map.get(t.date) ?? 0) + -convert(t.amount, cur.get(t.account_id) ?? base, base, rate));
  return map;
}

export const monthlyEquivalent = (amount: number, cadence: string) => (cadence === "weekly" ? (amount * 52) / 12 : cadence === "yearly" ? amount / 12 : amount);

export function advance(date: string, cadence: string) {
  const d = parseLocal(date);
  if (cadence === "weekly") return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7));
  if (cadence === "yearly") return ymd(new Date(d.getFullYear() + 1, d.getMonth(), d.getDate()));
  const target = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return ymd(new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last)));
}

export interface Projection { ok: boolean; reason?: string; basisMonths: string[]; avgIncome: number; avgExpense: number; avgNet: number; points: { month: string; value: number }[]; runwayMonths: number | null }
/**
 * Rule: take the average income and spending of the last (up to three) complete months and
 * carry the difference forward. Needs at least one complete month of history; otherwise
 * it declines to project rather than guess.
 */
export function project(accounts: Account[], txs: Tx[], base: string, rate: number, horizon = 6, now = new Date()): Projection {
  const complete = monthsBack(4, now).slice(0, 3);
  const flows = monthlyFlow(accounts, txs, base, rate, complete).filter((f) => f.income + f.expense > 0);
  if (!flows.length) return { ok: false, reason: "A projection needs at least one complete month of transactions.", basisMonths: [], avgIncome: 0, avgExpense: 0, avgNet: 0, points: [], runwayMonths: null };
  const avgIncome = flows.reduce((s, f) => s + f.income, 0) / flows.length;
  const avgExpense = flows.reduce((s, f) => s + f.expense, 0) / flows.length;
  const { net, liquid } = netWorth(accounts, txs, base, rate);
  const points = [];
  for (let i = 0; i <= horizon; i++) points.push({ month: monthKey(new Date(now.getFullYear(), now.getMonth() + i, 1)), value: net + (avgIncome - avgExpense) * i });
  return { ok: true, basisMonths: flows.map((f) => f.month), avgIncome, avgExpense, avgNet: avgIncome - avgExpense, points, runwayMonths: avgExpense > 0 ? liquid / avgExpense : null };
}

/** Maps a bank/CSV export onto transactions. Returns rows plus anything it could not read. */
export function mapStatement(rows: string[][]) {
  const find = (re: RegExp, head: string[]) => head.findIndex((h) => re.test(h.trim()));
  let h = rows.findIndex((r) => r.some((c) => /^(date|transaction date|posting date|value date)$/i.test(c.trim())));
  if (h < 0) return { ok: false as const, error: "No “Date” column header was found in the first sheet." };
  const head = rows[h];
  const cDate = find(/^(date|transaction date|posting date|value date)$/i, head);
  const cAmt = find(/^(amount|amt|value)$/i, head), cDebit = find(/^(debit|withdrawal|withdrawals|paid out|dr)$/i, head), cCredit = find(/^(credit|deposit|deposits|paid in|cr)$/i, head);
  const cDesc = find(/^(description|details|narration|particulars|payee|merchant|memo|transaction details)$/i, head), cCat = find(/^(category|type)$/i, head);
  if (cAmt < 0 && cDebit < 0 && cCredit < 0) return { ok: false as const, error: "No Amount, Debit or Credit column was found." };
  const num = (s: string | undefined) => { const v = parseFloat((s ?? "").replace(/[^\d.\-()]/g, "").replace(/^\((.*)\)$/, "-$1")); return Number.isFinite(v) ? v : 0; };
  const out: { date: string; amount: number; payee: string; category: string }[] = [];
  let skipped = 0;
  for (const r of rows.slice(h + 1)) {
    const date = normDate(r[cDate] ?? "");
    const amount = cAmt >= 0 ? num(r[cAmt]) : num(r[cCredit]) - Math.abs(num(r[cDebit]));
    if (!date || !amount) { if (r.some((c) => c.trim())) skipped++; continue; }
    out.push({ date, amount, payee: cDesc >= 0 ? (r[cDesc] ?? "").trim() : "", category: cCat >= 0 && r[cCat]?.trim() ? r[cCat].trim() : "Uncategorised" });
  }
  return { ok: true as const, rows: out, skipped };
}
export function normDate(s: string): string | null {
  s = s.trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/); // day first, as written in Pakistan
  if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; const [d, mo] = +m[2] > 12 ? [m[2], m[1]] : [m[1], m[2]]; return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`; }
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[a-z]*[-\s,]+(\d{2,4})/);
  if (m) { const mo = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[2].toLowerCase()); if (mo >= 0) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${String(mo + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  return null;
}
export const CATEGORIES = ["Food", "Transport", "Groceries", "Tuition", "Books & supplies", "Rent", "Utilities", "Mobile & internet", "Subscriptions", "Health", "Shopping", "Entertainment", "Family", "Gifts", "Savings", "Salary", "Stipend", "Freelance", "Allowance", "Uncategorised"];
