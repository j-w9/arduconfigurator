/**
 * Severity tone shared by every status banner / notice in the web app.
 * Extracted from App.tsx so state hooks (e.g. useParameterFeedback) can
 * type their notices without depending back on App.
 */
export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger'

const STATUS_TONE_LABELS: Record<StatusTone, string> = {
  neutral: 'Info',
  success: 'Success',
  warning: 'Warning',
  danger: 'Error'
}

/** Human-readable badge text for a tone. Notice badges historically rendered
 *  the raw tone enum ("danger" / "success") as their own label; use this so the
 *  pill reads as a word instead of an internal enum. */
export function statusToneLabel(tone: StatusTone): string {
  return STATUS_TONE_LABELS[tone]
}
