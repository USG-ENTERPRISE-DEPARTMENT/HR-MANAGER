// Subtle tinted wash + concentric "hairline" corner arcs (matches the Attendance
// report cards and the Help home cards). The card it sits in must be
// `relative overflow-hidden`. corner='br' places the arcs bottom-right (used on
// tables, whose opaque header would otherwise cover a top-right arc).
export function HairlineDecor({ color, corner = 'tr' }: { color: string; corner?: 'tr' | 'br' }) {
  const grad = corner === 'br'
    ? `linear-gradient(315deg, color-mix(in srgb, ${color} 6%, transparent), transparent 45%)`
    : `linear-gradient(225deg, color-mix(in srgb, ${color} 6%, transparent), transparent 45%)`;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <span className="absolute inset-0" style={{ background: grad }} />
      <svg className={`absolute -right-10 ${corner === 'br' ? '-bottom-10' : '-top-10'} h-28 w-28`} viewBox="0 0 96 96">
        <circle cx="48" cy="48" r="34" fill="none" strokeWidth="1" style={{ stroke: `color-mix(in srgb, ${color} 22%, transparent)` }} />
        <circle cx="48" cy="48" r="42" fill="none" strokeWidth="1" style={{ stroke: `color-mix(in srgb, ${color} 14%, transparent)` }} />
      </svg>
    </div>
  );
}
