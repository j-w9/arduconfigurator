// Brand monogram rendered in the top-left header. Pure inline SVG, no
// app state — kept as its own module so the App body doesn't carry the
// asset description.

export function AppHeaderLogo() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <g fill="none" stroke="rgba(236, 241, 247, 0.18)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
        <path d="M16 16 22.5 22.5" />
        <path d="M32 16 25.5 22.5" />
        <path d="M16 32 22.5 25.5" />
        <path d="M32 32 25.5 25.5" />
      </g>
      <circle cx="16" cy="16" r="3.4" fill="var(--accent)" />
      <circle cx="32" cy="16" r="3.4" fill="var(--accent)" />
      <circle cx="16" cy="32" r="3.4" fill="var(--accent)" />
      <circle cx="32" cy="32" r="3.4" fill="var(--accent)" />
      <path
        d="M24 12.5 31.4 29h-4.2l-1.55-3.75h-3.25L20.85 29h-4.25Zm0 7.2-1.35 3.35h2.7Z"
        fill="rgba(244, 247, 250, 0.96)"
      />
    </svg>
  )
}
