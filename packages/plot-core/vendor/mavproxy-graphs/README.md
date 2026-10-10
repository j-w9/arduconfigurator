# Vendored MAVExplorer graph definitions

`mavgraphs.xml` and `mavgraphs2.xml` are copied unmodified from
[MAVProxy](https://github.com/ArduPilot/MAVProxy) 1.8.74, path
`MAVProxy/tools/graphs/`. MAVProxy is licensed under the GNU GPL v3, compatible
with this repository's GPL-3.0-only licence.

`scripts/generate-mavgraphs.mjs` turns them into
`packages/plot-core/src/generated/mavgraphs.ts`. To update: copy the newer files
here, bump the version above and in the generator header, then run
`node scripts/generate-mavgraphs.mjs`.
