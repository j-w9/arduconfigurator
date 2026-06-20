# Contributing

Welcome. This project is trying to become a community-viable ArduPilot configurator for FPV hobbyists, with `app.betaflight.com` as the north star for shape and feel. It is not at the "accept anything anywhere" stage yet, so keep changes small, defensible, and aligned with the current product direction.

If you fly ArduCopter on a 10" multirotor or smaller and you have wanted a browser-first, task-focused configurator instead of a parameter spreadsheet, you are the audience and a likely useful contributor.

## Product Direction

Optimize for:

- setup and configuration first, on 10" multirotors and below
- clear, task-focused UI in the spirit of Betaflight Configurator
- verified writes, snapshots, and recoverability
- reusable shared runtime logic across web, desktop, and future surfaces

Avoid:

- turning the app into a general-purpose GCS
- broad tuning expansion before metadata/configuration coverage improves
- raw-parameter-first UX for common tasks (raw access lives in `Parameters` / `Expert` mode for a reason)

## Local Setup

```bash
npm install
```

Useful commands:

```bash
npm run dev:web
npm run desktop:app
npm run typecheck
npm run test
npm run test:e2e
npm run test:guided-setup
ARDUPILOT_REPO_PATH=/path/to/ardupilot npm run test:sitl
```

Desktop shell against a live web dev server:

```bash
npm run dev:web
npm run desktop:app:dev
```

## Validation Ladder

Use the lowest-risk validation path that can prove your change, working up only as far as you need to:

1. Mock runtime — `npm run test` (fast `node --test` suite against built packages)
2. Replay transport — deterministic recorded-session coverage without a live FC or SITL process
3. Playwright end-to-end — `npm run test:e2e` (builds the workspace, starts the preview server and the demo WebSocket bridge, runs browser regression flows)
4. True SITL — `ARDUPILOT_REPO_PATH=/path/to/ardupilot npm run test:sitl` for runtime/write-path changes
5. Live FC — browser `Web Serial` or desktop runtime against real hardware, for hardware-facing browser/runtime changes

For accelerometer-calibration changes specifically:

- cover both explicit completion-signal handling and the final-pose fallback path in runtime tests
- confirm live-FC behavior for first-pose advance and end-of-flow completion when that workflow is touched

## Pre-PR Checklist

Before opening a pull request, run:

```bash
npm run typecheck
npm run test
npm run test:e2e
```

CI runs all three on every PR (see `.github/workflows/ci.yml`), so failures here will block the PR anyway. Running them locally first keeps the review loop short.

For changes that touch the runtime, transport, or write paths, also walk the validation ladder up as far as the change deserves (SITL and/or a short live-FC pass).

## How to Contribute a New View

The browser UI is migrating to per-view presentational components under `apps/web/src/views/` (`Modes`, `Failsafe`, `Vtx`, `Osd`, `Power`, `Presets`, `Outputs`, plus the shared `ScopedField` editor helper), with larger view-conditional JSX blocks pulled into `apps/web/src/sections/` (e.g. `CalibrationSection`, `ParametersSection`, `PresetsSection`) and their derived view-state into pure builders under `apps/web/src/view-models/`. New views should follow the same pattern.

The pattern:

- **Dumb presentational components in `apps/web/src/views/<Name>.tsx`.** The view file exports a `<Name>View` component plus its `Props` / supporting types. Views should not import runtime, transport, or MAVLink modules directly — the parent (currently `App.tsx`) wires runtime state, derived labels, and callbacks in and passes them as plain props.
- **Slot props for complex sub-surfaces.** When a view has substantial sub-regions that themselves want to stay testable or reusable (`Outputs` is the current reference), expose them as `ReactNode` slot props such as `overviewSlot`, `taskBodySlot`, and `reviewDockSlot`. The view owns layout and chrome; the parent owns the slot contents.
- **`ScopedField` for editable parameter fields.** Use `ScopedSelectField` and `ScopedNumberField` from `apps/web/src/views/ScopedField.tsx` for editable parameter inputs so draft status (`unchanged` / dirty / pending) renders consistently across views. `Vtx`, `Osd`, and `Power` are the current reference users.
- **Stable `data-testid` hooks.** Add `data-testid` attributes on the structural anchors a contributor would target from Playwright (`view-button-<id>`, summary cards, table rows, primary CTAs). The e2e suite under `tests/e2e/views.spec.ts` builds on these.
- **Keep parameter wiring in the parent.** Edited values, draft status maps, and `onChange` handlers come in as props. Resist sneaking imports of runtime state into the view file.

Concretely, a new `Foo` view usually means:

1. A new `apps/web/src/views/Foo.tsx` exporting `FooView` and its prop types.
2. A small block in `App.tsx` that computes the derived labels / slot contents and renders `<FooView ... />`.
3. CSS additions in the existing stylesheet using the established BEM-ish naming (`foo-stack`, `foo-summary-card`, etc.).
4. An e2e block in `tests/e2e/views.spec.ts` covering the happy path against the demo transport.
5. README updates if the view shows up in the primary navigation.

## Visual Regression

`tests/e2e/visual.spec.ts` is a Playwright screenshot-diff scaffold over a handful of high-traffic views (landing, Setup, Modes, Failsafe, Logs, OSD). The spec is skipped by default until baselines exist on the current platform — the baselines are platform-specific (Linux Chromium in CI renders subtly differently than macOS or Windows) and committing the wrong-platform snapshots breaks CI.

To regenerate baselines on a Linux-equivalent environment (or in CI via a manual workflow dispatch):

```bash
ARDUCONFIG_VISUAL_REGEN=1 npx playwright test tests/e2e/visual.spec.ts --update-snapshots
```

After regeneration, inspect every produced `tests/e2e/__screenshots__/visual.spec.ts/*.png` before committing — those snapshots become the source of truth, so a stray loading state or telemetry blip captured at baseline time will haunt later diffs.

CI uploads `test-results/`, `playwright-report/`, and `tests/e2e/__screenshots__/` as workflow artifacts on failure (retention 7 days), so diffs are downloadable for review.

## Live Hardware Safety

- Remove props before any motor/output test.
- Prefer reversible writes on unused or non-critical settings first.
- Capture a snapshot/backup before risky live changes.
- Avoid active-port or active-receiver changes unless that exact behavior is what you are testing.

## Code Expectations

- Keep shared logic in `packages/*` when it affects more than one surface.
- Prefer product-shaped surfaces over pushing users into raw `Parameters`.
- Preserve the separation between transport, MAVLink/session, runtime behavior, and UI.
- Add tests for transport/runtime logic when behavior changes; add or update an e2e block when UI structure changes.
- Keep README / CONTRIBUTING aligned when major contributor-facing workflow changes land.
- Keep third-party UI assets attributed and license-compatible when reusing reference visuals such as pose diagrams or craft models.

## Pull Requests

A good change should usually include:

- the code change
- tests or an explicit reason tests were not added
- documentation/status updates when user-facing behavior changed
- a concise explanation of what was validated (which rungs of the validation ladder you walked)

Use the issue and PR templates in `.github` unless there is a strong reason not to.

## License Note

The repository is licensed under `GPL-3.0-only`. Do not add third-party code or assets casually; keep provenance and licensing clear, and make sure new additions are compatible with the repository license.
