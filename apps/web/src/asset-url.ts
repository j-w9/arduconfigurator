/**
 * Resolve a `public/` asset against the app's base URL.
 *
 * The app is served at the domain root in dev / `vite preview` (base
 * `/`) but under a project sub-path on GitHub Pages (base
 * `/ArduConfigurator/`, set via `ARDUCONFIG_WEB_BASE` at build). A
 * leading-slash literal like `/models/x.glb` is absolute from the
 * domain root and 404s on Pages; this prefixes the build-time base so
 * the URL is correct in both. Mirrors how `flight-deck-preview` already
 * resolves its model files.
 *
 * `import.meta.env.BASE_URL` is always normalized by Vite to end with a
 * trailing slash, so a single join is sufficient.
 */
export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL
  return `${base}${path.replace(/^\/+/, '')}`
}
