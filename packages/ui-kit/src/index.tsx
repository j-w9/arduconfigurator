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
        border: `1px solid ${color}48`,
        color: tone === 'neutral' ? palette.text : color,
        background: tone === 'neutral' ? 'rgba(255, 187, 0, 0.12)' : `${color}14`,
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 0.06,
        fontFamily: '"JetBrains Mono", "SFMono-Regular", "SF Mono", Consolas, monospace',
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
      letterSpacing: 0.01,
      cursor: 'pointer'
    }
  }
  return {
    border: `1px solid ${kind === 'primary' ? 'var(--primary-action-border, #6f9e59)' : 'rgba(255, 255, 255, 0.08)'}`,
    background:
      kind === 'primary'
        ? 'linear-gradient(180deg, var(--primary-action, #7fb966), var(--primary-action-border, #6f9e59))'
        : 'linear-gradient(180deg, rgba(47, 55, 63, 0.96), rgba(35, 41, 48, 0.98))',
    color: kind === 'primary' ? '#0a1308' : 'var(--text, #f2f2f2)',
    padding: '5px 12px',
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 12,
    letterSpacing: 0.01,
    cursor: 'pointer'
  }
}
