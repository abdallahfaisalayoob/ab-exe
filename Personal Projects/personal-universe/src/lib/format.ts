export function bytes(n: number) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / 1024 ** i).toFixed(i === 0 ? 0 : n / 1024 ** i >= 100 ? 0 : 1) + " " + u[i];
}
export type Currency = "PKR" | "USD";
export function money(n: number, cur: string = "PKR", opts: { compact?: boolean; sign?: boolean } = {}) {
  const abs = Math.abs(n);
  const sym = cur === "USD" ? "$" : cur === "PKR" ? "Rs " : cur + " ";
  let body: string;
  if (opts.compact && abs >= 100000) {
    body = abs >= 1e9 ? (abs / 1e9).toFixed(2) + "B" : abs >= 1e6 ? (abs / 1e6).toFixed(2) + "M" : (abs / 1e3).toFixed(0) + "k";
  } else {
    body = abs.toLocaleString("en-US", { minimumFractionDigits: cur === "USD" && abs % 1 ? 2 : 0, maximumFractionDigits: cur === "USD" ? 2 : 0 });
  }
  const sign = n < 0 ? "−" : opts.sign && n > 0 ? "+" : "";
  return sign + sym + body;
}
export const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const pct = (v: number) => Math.round(v * 100) + "%";
export const KIND_LABEL: Record<string, string> = { doc: "Documents", sheet: "Spreadsheets", slides: "Presentations", image: "Images", video: "Video", audio: "Audio", code: "Code", eng: "Engineering", data: "Data", archive: "Archives", other: "Other" };
export const KIND_COLOR: Record<string, string> = { doc: "#8FB4FF", sheet: "#7EDBA6", slides: "#F4A074", image: "#E9A6D8", video: "#C7A0F5", audio: "#F1C063", code: "#74D2D4", eng: "#B5D86B", data: "#9AA7BD", archive: "#B9A48A", other: "#8A8E9C" };
export const PALETTE = ["#A3A4FF", "#74D2D4", "#F4A074", "#7EDBA6", "#E9A6D8", "#F1C063", "#86B8F4", "#B5D86B", "#D3B0EA", "#F2857D", "#9AA7BD", "#E9CB8E"];
/** Builds a safe FTS5 query from free text: every word must match; the last one may be a prefix. */
export function ftsQuery(text: string) {
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 || /\d/.test(w));
  if (!words.length) return null;
  return words.map((w, i) => `"${w}"${i === words.length - 1 ? "*" : ""}`).join(" ");
}
/** Subsequence fuzzy score; higher is better, 0 means no match. */
export function fuzzy(needle: string, hay: string) {
  const n = needle.toLowerCase(), h = hay.toLowerCase();
  if (!n) return 1;
  const idx = h.indexOf(n);
  if (idx >= 0) return 100 - idx + (idx === 0 || /\W/.test(h[idx - 1]) ? 40 : 0) + n.length;
  let i = 0, score = 0, streak = 0;
  for (let j = 0; j < h.length && i < n.length; j++) {
    if (h[j] === n[i]) { i++; streak++; score += 2 + streak + (j === 0 || /\W/.test(h[j - 1]) ? 5 : 0); } else streak = 0;
  }
  return i === n.length ? score : 0;
}
