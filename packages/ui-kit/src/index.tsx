import type { CSSProperties, PropsWithChildren, ReactNode } from 'react'

const palette = {
  surface: 'var(--bg-panel, #141414)',
  surfaceRaised: 'var(--bg-panel-raised, #1f1f1f)',
  surfaceInset: 'var(--bg-panel-soft, #242424)',
  border: 'var(--border, #3d3d3d)',
  borderStrong: 'var(--border-strong, #595959)',
  text: 'var(--text, #f2f2f2)',
  muted: 'var(--text-muted, #b3b3b3)',
  dim: 'var(--text-dim, #999999)',
  accent: 'var(--accent, #ffbb00)',
  primary: 'var(--primary-action, #7fb966)',
  success: 'var(--success, #7fb966)',
  warning: 'var(--warning, #ff6600)',
  danger: 'var(--danger, #e2123f)'
}

export function Panel({
  title,
  subtitle,
  actions,
  children
}: PropsWithChildren<{ title: string; subtitle?: string; actions?: ReactNode }>) {
  return (
    <section
      style={{
        background: 'transparent',
        border: 'none',
        borderRadius: 0,
        padding: 0
      }}
    >
      {/* Panel title block. Pulled in from 32px to 24px (2026-05-20
        * audit), then to 18px (2026-06-10 density audit) — the title is
        * the largest single density loss on every tab. CSS vars used so
        * themes / future zoom modes can override. */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 'var(--space-3, 12px)' }}>
        <div style={{ minWidth: 0 }}>
          <h2
            style={{
              margin: 0,
              color: palette.text,
              fontSize: 'var(--font-title, 18px)',
              lineHeight: 1,
              letterSpacing: -0.04,
              fontWeight: 600,
              display: 'inline-block'
            }}
          >
            {title}
          </h2>
          {subtitle ? <p style={{ margin: '8px 0 0', color: palette.muted, lineHeight: 1.55, fontSize: 13, maxWidth: 720 }}>{subtitle}</p> : null}
        </div>
        {actions}
      </div>
      <div>{children}</div>
    </section>
  )
}

export function StatusBadge({ tone, children }: PropsWithChildren<{ tone: 'neutral' | 'success' | 'warning' | 'danger' }>) {
  const color =
    tone === 'success' ? palette.success : tone === 'warning' ? palette.warning : tone === 'danger' ? palette.danger : palette.accent

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        minHeight: 20,
        padding: '2px 8px',
        borderRadius: 999,
        // `${color}48` appended an alpha byte to a hex literal -- but every
        // palette entry is a var() string, so the result was the invalid
        // "var(--success, #7fb966)48" and both the border and the fill were
        // dropped. Only the neutral tone survived, because it used a literal
        // rgba(), which is why a toned badge read as bare coloured text beside
        // a filled neutral one in the same tab strip. color-mix() composes with
        // var() the way the app's stylesheet already does.
        border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
        color: tone === 'neutral' ? palette.text : color,
        background:
          tone === 'neutral'
            ? 'rgba(var(--primary-rgb, 255, 187, 0), 0.12)'
            : `color-mix(in srgb, ${color} 8%, transparent)`,
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        // A bare number is px in React, so this was 0.06px -- no tracking at
        // all on an uppercase label.
        letterSpacing: '0.08em',
        fontFamily: 'var(--font-data, "JetBrains Mono", "SFMono-Regular", monospace)',
        lineHeight: 1.4
      }}
    >
      {children}
    </span>
  )
}

export function buttonStyle(kind: 'primary' | 'secondary' | 'hero' = 'secondary'): CSSProperties {
  if (kind === 'hero') {
    return {
      border: '1px solid var(--primary-600, #e8a803)',
      background: 'var(--primary-500, #ffbb00)',
      color: '#111111',
      padding: '8px 14px',
      borderRadius: 8,
      fontWeight: 600,
      fontSize: 13,
      letterSpacing: 'normal',
      cursor: 'pointer'
    }
  }
  return {
    // Secondary bg/border come from theme tokens so the button flips with the
    // light theme (inline styles still resolve CSS var()); the fallbacks are the
    // original dark values.
    border: `1px solid ${kind === 'primary' ? 'var(--primary-action-border, #6f9e59)' : 'var(--btn-border, rgba(255, 255, 255, 0.08))'}`,
    background:
      kind === 'primary'
        ? 'linear-gradient(180deg, var(--primary-action, #7fb966), var(--primary-action-border, #6f9e59))'
        : 'var(--btn-bg, linear-gradient(180deg, rgba(47, 55, 63, 0.96), rgba(35, 41, 48, 0.98)))',
    color: kind === 'primary' ? '#0a1308' : 'var(--btn-text, var(--text, #f2f2f2))',
    padding: '5px 12px',
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 12,
    letterSpacing: 'normal',
    cursor: 'pointer'
  }
}
