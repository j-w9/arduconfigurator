# Releasing

The release process is source-first, with an auto-published browser build and automated desktop installer builds attached to tagged GitHub releases.

## Current Release Shapes

- Source release from a tagged commit on `main`
- Browser build output from `apps/web`, auto-deployed on every push to `main` (production home: <https://arduconfigurator.com>)
- Unsigned desktop installers (macOS `.dmg`, Windows `.exe`, Linux `.AppImage`) attached to GitHub releases by the `Desktop Release` workflow

## Release Checklist

1. Ensure the branch is clean and based on the intended `main` tip.
2. Run:
   - `npm ci`
   - `npm run typecheck`
   - `npm run test`
   - `npm run test:e2e`
3. Run `npm run test:sitl` when the change touches runtime/write-path behavior.
4. Run a short live-FC pass for hardware-facing workflow changes.
   For calibration-flow changes, explicitly verify the flow does not stall at the first pose or the final pose.
5. Update public docs when contributor-facing or user-facing behavior changed:
   - `README.md`
   - `CONTRIBUTING.md`
   - `SUPPORT.md`
   - `SECURITY.md`
   Keep attribution current when calibration visuals or other third-party assets change.
6. Confirm no private planning material or local-only artifacts are staged.
7. Write concise release notes that summarize:
   - the product/user-visible changes
   - validation performed
   - known gaps or risks

## Tagging

Use lightweight semantic versioning while the project is pre-1.0:

- `v0.x.y`

Patch releases should be safe regressions or packaging/doc updates. Minor releases can expand supported configuration coverage or major validated product workflows.

## Browser Build

Build the browser app with:

```bash
npm run build --workspace @arduconfig/web
```

The output is a static web bundle under `apps/web/dist`.

## Hosted web app

The production home of the web app is <https://arduconfigurator.com> (hosted on
Cloudflare Pages). It runs the bundled in-browser mock runtime, so the full
interface is explorable with no hardware connected.

The `.github/workflows/web-deploy.yml` workflow auto-publishes the static
`apps/web` bundle to GitHub Pages on every push to `main` (and on demand via
the **Run workflow** button on the Actions tab). The workflow builds the bundle
with `ARDUCONFIG_WEB_BASE=/ArduConfigurator/` so Vite emits asset URLs under the
Pages subpath, then uses the official `actions/configure-pages`,
`actions/upload-pages-artifact`, and `actions/deploy-pages` actions to publish
the result. A `concurrency: pages` group with `cancel-in-progress: true` keeps a
fast-follow merge from deploying a stale build over a fresher one.

For local development, `vite dev` and `vite preview` serve from `/` because
`ARDUCONFIG_WEB_BASE` defaults to `/` when unset.

## Desktop Local Builds

Build the desktop shell with:

```bash
npm run build:desktop
```

or build both browser and desktop together with:

```bash
npm run desktop:app
```

This produces the runnable Electron shell. For shippable installers, use the `Desktop Release` workflow described below instead of distributing the dev-mode shell.

## Desktop Installers

Desktop installers are produced by `.github/workflows/desktop-release.yml`. The workflow runs in two scenarios:

- Automatically when a tag matching `v*` is pushed to the repository.
- On demand via the **Run workflow** button (`workflow_dispatch`) on the Actions tab.

The workflow runs three platform-specific build jobs in parallel and then a final `attach-release` job that uploads the resulting installers to the GitHub release created by the tag.

### What each job produces

| Job | Runner | Output(s) | Notes |
| --- | --- | --- | --- |
| `build-mac` | `macos-latest` | `apps/desktop/release/*.dmg` | Universal binary (Apple Silicon + Intel). |
| `build-windows` | `windows-latest` | `apps/desktop/release/*.exe` | NSIS installer (x64). |
| `build-linux` | `ubuntu-latest` | `apps/desktop/release/*.AppImage` | AppImage (x64). |

Each job uploads its output as a workflow artifact (`desktop-mac`, `desktop-windows`, `desktop-linux`) with a 14-day retention so a maintainer can grab installers from a `workflow_dispatch` run even without cutting a tag.

### Attaching to a release

On tag pushes (`refs/tags/v*`), the `attach-release` job downloads all three artifacts and runs `gh release upload "$GITHUB_REF_NAME" ... --clobber` to attach them to the release that the tag created. `--clobber` is used so re-runs of the workflow replace earlier assets cleanly.

### Cutting a desktop release

1. Land all desired changes on `main` and ensure CI is green.
2. Tag the commit, e.g. `git tag v0.2.0-alpha && git push origin v0.2.0-alpha`.
3. Watch the `Desktop Release` workflow. Once all three build jobs finish, `attach-release` will attach `.dmg`, `.exe`, and `.AppImage` files to the GitHub release for that tag.
4. Edit the GitHub release notes to describe what changed and call out the security warning below.

### Installers are unsigned

Installers built by this workflow are **not** code-signed or notarized. This is a deliberate scope choice for the current hobbyist pre-release phase.

End users will see security warnings the first time they launch the app:

- **macOS**: Gatekeeper will refuse to open the app and may report it as damaged. Users can right-click the app in Finder and choose **Open**, or run `xattr -dr com.apple.quarantine /Applications/ArduConfigurator.app` after installing. The DMG itself is also unsigned.
- **Windows**: SmartScreen will show a blue **Windows protected your PC** dialog. Users can click **More info → Run anyway**. Some antivirus tools may also flag the NSIS installer.
- **Linux**: The AppImage runs without warnings, but users must `chmod +x ArduConfigurator-*.AppImage` before launching.

Adding code-signing certificates (Apple Developer ID, EV code-signing cert for Windows) is tracked as future work; do not add signing secrets to the workflow until that decision is made.
