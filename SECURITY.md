# Security Policy

## About This Repository

ArduConfigurator is a configurator for **real flight controllers**. The browser tab can
open serial or USB connections to live hardware, read calibration and parameter state,
and write changes back. That means certain classes of issue matter more here than in a
typical web app:

- credential or telemetry leakage from a connected flight controller
- unintended or unconfirmed writes to a live FC (parameter, mode, output, or arming state)
- misleading UI that could plausibly induce an unsafe in-field configuration
- transport / framing bugs that could corrupt parameter writes mid-stream
- code paths that bypass the project's "verify after write" or snapshot guards

If you have found something that falls in or near those categories, please treat it as a
security report rather than a regular bug.

## Scope

In scope for this policy:

- code in this repository (the web app, the desktop shell, the bundled bridge, the
  shared runtime / transport / metadata packages)
- the published build artifacts produced from this repository

Out of scope here:

- vulnerabilities in the underlying **ArduPilot firmware** — those belong with the
  ArduPilot project at <https://github.com/ArduPilot/ardupilot/security>
- vulnerabilities in third-party dependencies that have their own disclosure channels

## Supported Versions

The latest `main` is the supported line. Security fixes land on `main`; there is no LTS
branch and no backport program.

## Reporting A Vulnerability

Please do **not** open a public GitHub issue, public PR, or public discussion thread for
anything that could affect connected aircraft, host machines, or user data.

Preferred channel: **GitHub private vulnerability reporting** on this repository.

1. Go to the [Security tab](https://github.com/j-w9/arduconfigurator/security) of this
   repo.
2. Choose "Report a vulnerability".
3. File a private advisory draft. The maintainer is notified directly.

If GitHub's private reporting is unavailable to you, opening a minimal public issue that
says only "requesting a private security contact" (with no details) is acceptable as a
fallback.

When you report, it helps to include:

- which component or view is affected (web app, desktop shell, bridge, a specific
  package under `packages/`, etc.)
- the impact and a plausible attack or misuse scenario
- reproduction steps or a proof of concept, ideally against the current `main`
- whether the issue requires a real flight controller to be connected, or whether it
  reproduces against the demo / replay transport
- any suggested fix direction, if you have one

## What To Expect Back

- a maintainer will review the report when time allows
- you will get an acknowledgement, an assessment of scope, and a rough plan
- if a fix is warranted, it will land on `main` and be called out in the release notes
- coordinated disclosure timing is fine; please do not publish full details before a fix
  is available if the issue has real-world flight-safety impact

Thanks for taking the time to report responsibly.
