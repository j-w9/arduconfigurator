// Curated analog VTX band/power presets, expressed as Betaflight `vtxtable`
// CLI snippets so they load through the same parseBetaflightVtxTable path the
// manual import uses. These are for ANALOG VTX only (SmartAudio/Tramp) — a
// digital/MSP VTX learns its table from the goggles and renders read-only.
//
// Provenance: the band/frequency maps are the standard Betaflight vtxtable
// defaults (Boscam A/B/E, Fatshark, Raceband) — the same tried-and-true tables
// Betaflight Configurator ships. Betaflight is GPL-3.0, compatible with this
// project's GPL-3.0-only license. See CLAUDE.md on third-party provenance.
// The power ladders are the common analog values (mW for Tramp; SmartAudio 2.1
// maps the same steps) — edit any cell after loading a preset before Save.

export interface VtxTablePresetDefinition {
  /** Stable id used as the <option> value. */
  id: string
  /** Short human label for the picker. */
  label: string
  /** One-line description of what the preset covers. */
  description: string
  /** Betaflight `vtxtable` CLI snippet, parsed by parseBetaflightVtxTable. */
  table: string
}

// The universal 5-band / 8-channel analog frequency map (40CH). Every analog
// preset below reuses these exact rows; only the band set / power ladder vary.
const STANDARD_40CH_BANDS = [
  'vtxtable band 1 BOSCAM_A A FACTORY 5865 5845 5825 5805 5785 5765 5745 5725',
  'vtxtable band 2 BOSCAM_B B FACTORY 5733 5752 5771 5790 5809 5828 5847 5866',
  'vtxtable band 3 BOSCAM_E E FACTORY 5705 5685 5665 5645 5885 5905 5925 5945',
  'vtxtable band 4 FATSHARK F FACTORY 5740 5760 5780 5800 5820 5840 5860 5880',
  'vtxtable band 5 RACEBAND R FACTORY 5658 5695 5732 5769 5806 5843 5880 5917',
].join('\n')

const POWER_25_600 = [
  'vtxtable powerlevels 5',
  'vtxtable powervalues 25 100 200 400 600',
  'vtxtable powerlabels 25 100 200 400 600',
].join('\n')

const POWER_25_800 = [
  'vtxtable powerlevels 4',
  'vtxtable powervalues 25 100 400 800',
  'vtxtable powerlabels 25 100 400 800',
].join('\n')

const POWER_WHOOP = [
  'vtxtable powerlevels 3',
  'vtxtable powervalues 25 100 200',
  'vtxtable powerlabels 25 100 200',
].join('\n')

export const VTX_TABLE_PRESETS: readonly VtxTablePresetDefinition[] = [
  {
    id: 'standard-40ch-25-600',
    label: 'Standard 40CH · 25–600 mW',
    description: 'Boscam A/B/E, Fatshark, Raceband — the universal analog table with a 25/100/200/400/600 mW ladder.',
    table: ['vtxtable bands 5', 'vtxtable channels 8', STANDARD_40CH_BANDS, POWER_25_600].join('\n'),
  },
  {
    id: 'standard-40ch-25-800',
    label: 'Standard 40CH · 25–800 mW',
    description: 'Same 40CH frequency map with a higher 25/100/400/800 mW ladder for high-power analog VTX.',
    table: ['vtxtable bands 5', 'vtxtable channels 8', STANDARD_40CH_BANDS, POWER_25_800].join('\n'),
  },
  {
    id: 'raceband-8ch-25-600',
    label: 'Raceband 8CH · 25–600 mW',
    description: 'Raceband only (R1–R8) for racing — a single 8-channel band with the 25/100/200/400/600 mW ladder.',
    table: [
      'vtxtable bands 1',
      'vtxtable channels 8',
      'vtxtable band 1 RACEBAND R FACTORY 5658 5695 5732 5769 5806 5843 5880 5917',
      POWER_25_600,
    ].join('\n'),
  },
  {
    id: 'standard-40ch-whoop',
    label: 'Standard 40CH · whoop (25–200 mW)',
    description: 'Full 40CH map with a low 25/100/200 mW ladder for tiny-whoop / indoor analog VTX.',
    table: ['vtxtable bands 5', 'vtxtable channels 8', STANDARD_40CH_BANDS, POWER_WHOOP].join('\n'),
  },
]
