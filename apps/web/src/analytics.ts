// Analytics hooks. No analytics provider is wired in this build, so these
// are no-ops — call sites can record intent without shipping any
// third-party tracking script or beacon. Swap the bodies if a provider is
// added later.

type AnalyticsValue = string | number | boolean | null | undefined

export function trackViewPageview(_viewId: string): void {
  // no-op
}

export function trackAppEvent(_name: string, _properties?: Record<string, AnalyticsValue>): void {
  // no-op
}
