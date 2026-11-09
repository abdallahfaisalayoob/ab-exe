// Engineering helpers for the Tools world. All offline, all exact arithmetic on doubles.
const PREFIX: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12 };
/** "4.7k" → 4700, "10u" → 1e-5, "2M2" → 2.2e6, "1e3" → 1000. NaN when unreadable. */
export function parseEng(s: string): number {
  const t = s.trim().replace(/,/g, "").replace(/\s*(ohms?|Ω|hz|v|a|w|f|h|s|m)$/i, (m) => (/^[munpkMGT]$/.test(m) ? m : ""));
  if (!t) return NaN;
  let m = t.match(/^(-?\d+)([pnuµmkKMGT])(\d+)$/); // 4k7
  if (m) return parseFloat(`${m[1]}.${m[3]}`) * PREFIX[m[2]];
  m = t.match(/^(-?\d*\.?\d+(?:e[-+]?\d+)?)\s*([pnuµmkKMGT])?$/i);
  if (!m) return NaN;
  return parseFloat(m[1]) * (m[2] ? PREFIX[m[2]] ?? PREFIX[m[2].toLowerCase()] ?? 1 : 1);
}
export function fmtEng(v: number, unit = "", digits = 4): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0 " + unit;
  const steps: [number, string][] = [[1e12, "T"], [1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"]];
  const a = Math.abs(v);
  const [f, p] = steps.find(([f]) => a >= f * 0.9999999) ?? steps[steps.length - 1];
  return `${parseFloat((v / f).toPrecision(digits))} ${p}${unit}`.trim();
}

/** Any two of V, I, R, P determine the other two. */
export function ohm(known: { V?: number; I?: number; R?: number; P?: number }): { V: number; I: number; R: number; P: number } | null {
  let { V, I, R, P } = known;
  const has = (x?: number) => x != null && Number.isFinite(x);
  if ([V, I, R, P].filter(has).length < 2) return null;
  if (has(V) && has(I)) { R = V! / I!; P = V! * I!; }
  else if (has(V) && has(R)) { I = V! / R!; P = (V! * V!) / R!; }
  else if (has(I) && has(R)) { V = I! * R!; P = I! * I! * R!; }
  else if (has(P) && has(V)) { I = P! / V!; R = (V! * V!) / P!; }
  else if (has(P) && has(I)) { V = P! / I!; R = P! / (I! * I!); }
  else if (has(P) && has(R)) { V = Math.sqrt(P! * R!); I = Math.sqrt(P! / R!); }
  return { V: V!, I: I!, R: R!, P: P! };
}

export const BANDS = [["black", "#1b1b1b"], ["brown", "#7a4a21"], ["red", "#d0312d"], ["orange", "#f08a24"], ["yellow", "#f2d13a"], ["green", "#3a9d4a"], ["blue", "#2f6fd6"], ["violet", "#8a4fc9"], ["grey", "#8a8f98"], ["white", "#f4f4f4"], ["gold", "#c9a227"], ["silver", "#b9bec6"]] as const;
const MULT = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 0.1, 0.01];
export const TOLERANCE: Record<number, number> = { 1: 1, 2: 2, 5: 0.5, 6: 0.25, 7: 0.1, 8: 0.05, 10: 5, 11: 10 };
/** digits are colour indices 0–9; multiplier and tolerance are indices into BANDS. */
export function resistor(digits: number[], multiplier: number, tolerance: number) {
  const value = digits.reduce((n, d) => n * 10 + d, 0) * MULT[multiplier];
  const tol = TOLERANCE[tolerance] ?? 20;
  return { value, tol, min: value * (1 - tol / 100), max: value * (1 + tol / 100) };
}

export function toBases(input: string, base: number, bits = 0) {
  const clean = input.trim().replace(/^0[xbo]/i, "").replace(/[\s_]/g, "");
  if (!clean || !new RegExp(`^-?[${"0123456789abcdef".slice(0, base)}]+$`, "i").test(clean)) return null;
  let n = BigInt(parseInt(clean, base));
  if (!Number.isSafeInteger(Number(n))) return null;
  const signed = n;
  if (bits && n < 0n) n = (1n << BigInt(bits)) + n; // two's complement
  if (n < 0n) return { dec: signed.toString(), hex: "-" + (-n).toString(16).toUpperCase(), bin: "-" + (-n).toString(2), oct: "-" + (-n).toString(8) };
  const bin = n.toString(2);
  return { dec: signed.toString(), hex: n.toString(16).toUpperCase(), bin: bits ? bin.padStart(bits, "0") : bin, oct: n.toString(8) };
}

// Boolean algebra: a small recursive-descent parser. Precedence: NOT > AND > XOR > OR.
type Tok = { t: "var" | "op" | "lp" | "rp" | "const"; v: string };
function lex(src: string): Tok[] {
  const out: Tok[] = [];
  const s = src.replace(/·|∧|&&|\*/g, "&").replace(/∨|\|\|/g, "|").replace(/¬|~/g, "!").replace(/⊕/g, "^");
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "(") { out.push({ t: "lp", v: c }); i++; continue; }
    if (c === ")") { out.push({ t: "rp", v: c }); i++; continue; }
    if ("&|!^+'".includes(c)) { out.push({ t: "op", v: c === "+" ? "|" : c }); i++; continue; }
    if (c === "0" || c === "1") { out.push({ t: "const", v: c }); i++; continue; }
    const m = s.slice(i).match(/^[A-Za-z][A-Za-z0-9_]*/);
    if (!m) throw new Error(`Unexpected “${c}”`);
    const w = m[0].toUpperCase();
    if (["AND", "OR", "NOT", "XOR", "NAND", "NOR", "XNOR"].includes(w)) out.push({ t: "op", v: { AND: "&", OR: "|", NOT: "!", XOR: "^", NAND: "nand", NOR: "nor", XNOR: "xnor" }[w]! });
    // Textbook style: a run of capitals is a product of single-letter variables (AB = A·B). Names like clk or x1 stay whole.
    else if (/^[A-Z]{2,}$/.test(m[0])) for (const ch of m[0]) out.push({ t: "var", v: ch });
    else out.push({ t: "var", v: m[0] });
    i += m[0].length;
  }
  return out;
}
type Fn = (env: Record<string, boolean>) => boolean;
export function compileBool(src: string): { vars: string[]; fn: Fn } {
  const toks = lex(src);
  if (!toks.length) throw new Error("Type an expression, e.g. A & (B | !C)");
  let p = 0;
  const vars = new Set<string>();
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === "op" && peek().v === v;
  const atom = (): Fn => {
    const t = toks[p++];
    if (!t) throw new Error("The expression ends too early");
    let f: Fn;
    if (t.t === "op" && t.v === "!") { const a = atom(); f = (e) => !a(e); }
    else if (t.t === "lp") { f = or(); if (toks[p++]?.t !== "rp") throw new Error("Missing closing bracket"); }
    else if (t.t === "var") { vars.add(t.v); f = (e) => e[t.v]; }
    else if (t.t === "const") f = () => t.v === "1";
    else throw new Error(`Unexpected “${t.v}”`);
    while (isOp("'")) { p++; const g = f; f = (e) => !g(e); } // postfix complement: A'
    return f;
  };
  const and = (): Fn => {
    let l = atom();
    for (;;) {
      if (isOp("&")) { p++; const a = l, b = atom(); l = (e) => a(e) && b(e); }
      else if (isOp("nand")) { p++; const a = l, b = atom(); l = (e) => !(a(e) && b(e)); }
      else if (peek() && (peek().t === "var" || peek().t === "lp" || peek().t === "const" || isOp("!"))) { const a = l, b = atom(); l = (e) => a(e) && b(e); } // implicit AND: AB
      else return l;
    }
  };
  const xor = (): Fn => { let l = and(); for (;;) { if (isOp("^")) { p++; const a = l, b = and(); l = (e) => a(e) !== b(e); } else if (isOp("xnor")) { p++; const a = l, b = and(); l = (e) => a(e) === b(e); } else return l; } };
  const or = (): Fn => { let l = xor(); for (;;) { if (isOp("|")) { p++; const a = l, b = xor(); l = (e) => a(e) || b(e); } else if (isOp("nor")) { p++; const a = l, b = xor(); l = (e) => !(a(e) || b(e)); } else return l; } };
  const fn = or();
  if (p < toks.length) throw new Error(`Unexpected “${toks[p].v}”`);
  const list = [...vars].sort();
  if (list.length > 6) throw new Error("Up to six variables, please");
  return { vars: list, fn };
}
export function truthTable(src: string) {
  const { vars, fn } = compileBool(src);
  const rows: { in: boolean[]; out: boolean }[] = [];
  for (let i = 0; i < 1 << vars.length; i++) {
    const bits = vars.map((_, j) => !!((i >> (vars.length - 1 - j)) & 1));
    rows.push({ in: bits, out: fn(Object.fromEntries(vars.map((v, j) => [v, bits[j]]))) });
  }
  const minterms = rows.map((r, i) => (r.out ? i : -1)).filter((i) => i >= 0);
  return { vars, rows, minterms };
}

export const UNITS: Record<string, Record<string, number | [number, number]>> = {
  Length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, "µm": 1e-6, inch: 0.0254, ft: 0.3048, mile: 1609.344, mil: 2.54e-5 },
  Mass: { kg: 1, g: 0.001, mg: 1e-6, lb: 0.45359237, oz: 0.028349523 },
  Temperature: { "°C": [1, 273.15], K: [1, 0], "°F": [5 / 9, 255.3722222] },
  Energy: { J: 1, kJ: 1000, Wh: 3600, kWh: 3.6e6, cal: 4.184, eV: 1.602176634e-19 },
  Power: { W: 1, kW: 1000, mW: 0.001, hp: 745.699872 },
  Data: { bit: 1, byte: 8, KiB: 8192, MiB: 8388608, GiB: 8589934592, kb: 1000, Mb: 1e6, Gb: 1e9 },
  Pressure: { Pa: 1, kPa: 1000, bar: 1e5, atm: 101325, psi: 6894.757 },
  Angle: { rad: 1, deg: Math.PI / 180, rev: 2 * Math.PI },
  Time: { s: 1, ms: 0.001, "µs": 1e-6, ns: 1e-9, min: 60, h: 3600 },
};
export function convertUnit(group: string, v: number, from: string, to: string) {
  const g = UNITS[group], f = g[from], t = g[to];
  const base = Array.isArray(f) ? v * f[0] + f[1] : v * f;
  return Array.isArray(t) ? (base - t[1]) / t[0] : base / t;
}
