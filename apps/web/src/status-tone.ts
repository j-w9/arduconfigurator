/**
 * Severity tone shared by every status banner / notice in the web app.
 * Extracted from App.tsx so state hooks (e.g. useParameterFeedback) can
 * type their notices without depending back on App.
 */
export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger'
