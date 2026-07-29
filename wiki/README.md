# ArduConfigurator Wiki

Sphinx + Read-the-Docs theme (the same stack as the ArduPilot wiki), served at
`arduconfigurator.com/wiki`. Responsive/phone-friendly via the RTD theme.

## Build locally

```bash
cd wiki
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
sphinx-build -b html . _build/html
# preview:
python3 -m http.server -d _build/html 8000   # http://localhost:8000
```

Content is reStructuredText. The nav/structure mirrors the app's tabs and the
guided-setup order. See `index.rst` for the table of contents.

## Parameter reference

`parameters/` holds the full ArduPilot parameter reference. Upstream publishes
it as one page per vehicle — 5689 parameters for Copter 4.7, which will not load
on a phone. Here it is split into one page per parameter family, plus a
type-ahead search page backed by a small prebuilt index.

The pages are **generated, not committed**. Before building locally:

```bash
python3 tools/generate_parameter_reference.py   # from wiki/
sphinx-build -b html . _build/html
```

CI runs the generator automatically (see `.github/workflows/web-deploy.yml`).

To move to a new firmware release, refresh the pinned metadata and regenerate:

```bash
curl -o wiki/data/apm.pdef.Copter-4.7.json \
  https://raw.githubusercontent.com/ArduPilot/ParameterRepository/master/Copter-4.7/apm.pdef.json
```

The source JSON is pinned in `wiki/data/` so the build stays hermetic — no
network at build time, and the docs cannot change under a release without a
visible commit.
