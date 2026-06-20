// Build-time metadata injected by vite `define` (vite.config.ts). The
// `typeof` guards keep this safe if the bundle is ever evaluated without
// the define applied (e.g. a bare unit-test import).
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'
export const GIT_HASH = typeof __GIT_HASH__ !== 'undefined' ? __GIT_HASH__ : 'unknown'
export const GIT_BRANCH = typeof __GIT_BRANCH__ !== 'undefined' ? __GIT_BRANCH__ : 'unknown'
