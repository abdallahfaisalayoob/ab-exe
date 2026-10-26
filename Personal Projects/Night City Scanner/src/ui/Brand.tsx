/** Original logo: a document with a folded corner, sliced by a scan line. */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden>
      <defs>
        <linearGradient id="ncs-g" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ff2a6d" />
          <stop offset="1" stopColor="#2de2e6" />
        </linearGradient>
      </defs>
      <path d="M12 5h30l10 10v44H12z" stroke="#2de2e6" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M42 5v10h10" stroke="#2de2e6" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M19 23h18M19 44h26M19 50h16" stroke="#eef3f8" strokeOpacity=".45" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M5 33h54" stroke="url(#ncs-g)" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

export function BrandMark({ compact }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`}>
      <Logo size={compact ? 34 : 56} />
      <div className="brand__text">
        <span className="brand__name">Night City</span>
        <span className="brand__sub">Scanner</span>
      </div>
    </div>
  );
}
