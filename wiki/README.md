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
