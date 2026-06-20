# Support

Use GitHub issues for public support unless the problem is security-sensitive.

## Good Support Requests

Include as much of the following as applies:

- what you were trying to do
- transport path used: `Demo`, `Web Serial`, `WebSocket`, desktop shell, or runtime CLI
- FC / firmware context if hardware is involved
- whether the problem reproduces in `npm run test`, `npm run test:e2e`, or SITL
- screenshots or short recordings for UI regressions
- relevant logs or status text

## Before Filing

Work through the normal validation ladder first:

1. `npm run typecheck`
2. `npm run test`
3. `npm run test:e2e` for browser/UI regressions
4. `npm run test:sitl` for runtime/write-path changes when relevant
5. a short live-FC pass only when hardware behavior actually matters

## Where To File

- Bug reports: use the bug report issue template
- Product improvements: use the feature request issue template
- Security concerns: do not file a public issue; follow [SECURITY.md](SECURITY.md)

## Scope

This repository is a browser-first ArduPilot configurator. Requests that turn it into a general-purpose GCS or bypass the project’s safety model are unlikely to be accepted.
