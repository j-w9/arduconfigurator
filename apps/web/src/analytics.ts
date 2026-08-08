// Analytics hooks, deliberately no-ops. Nothing is wired in and nothing is
// sent: call sites can express intent without the app acquiring any
// third-party tracking script or background reporting. If a provider is ever
// added, these bodies are the single place it would go.

type AnalyticsValue = string | number | boolean | null | undefined

export function trackViewPageview(_viewId: string): void {
  // no-op
}

export function trackAppEvent(_name: string, _properties?: Record<string, AnalyticsValue>): void {
  // no-op
}
