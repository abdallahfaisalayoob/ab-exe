import type { ReactNode } from "react";
import type { Severity } from "../types/simulator";

interface Props {
  severity?: Severity | "ok";
  children: ReactNode;
}

const classes = {
  ok: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  info: "border-cyan-300/30 bg-cyan-300/10 text-cyan-100",
  warning: "border-amber-300/35 bg-amber-300/12 text-amber-100",
  critical: "border-red-300/35 bg-red-400/12 text-red-100",
};

export function StatusPill({ severity = "ok", children }: Props) {
  return <span className={`inline-flex items-center rounded border px-2 py-1 text-xs font-medium ${classes[severity]}`}>{children}</span>;
}
