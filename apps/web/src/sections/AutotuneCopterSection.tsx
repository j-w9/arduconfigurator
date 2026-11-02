// AutotuneCopterSection — the ArduCopter AUTOTUNE setup (AUTOTUNE_AXES / AGGR
// / MIN_D / GMBK, AC_AutoTune_Multi) as a compact grid, plus the in-flight
// procedure. Edits stage through the shared draft set and are written from
// the global draft bar like every other tab; it has no write path of its own.

import type { ReactElement } from 'react'
import type { ConfiguratorSnapshot, ParameterDraftEntry, ParameterState } from '@arduconfig/ardupilot-core'

import { AUTOTUNE_COPTER_PARAM_IDS } from '../autotune-params'
import { formatNumericDisplayValue } from '../parameter-format'
import { selectParameterById } from '../selectors/parameter-read'
import { FeelGrid, type PilotFeelValue } from '../views/PilotFeel'

export interface AutotuneCopterSectionProps {
  snapshot: ConfiguratorSnapshot
  editedValues: Record<string, string>
  parameterDraftById: ReadonlyMap<string, ParameterDraftEntry>
  setDraft: (paramId: string, value: string) => void
}

const LABELS: Record<string, string> = {
  AUTOTUNE_AXES: 'Axes',
  AUTOTUNE_AGGR: 'Aggressiveness',
  AUTOTUNE_MIN_D: 'Minimum D',
  AUTOTUNE_GMBK: 'Gain margin backoff'
}

export function AutotuneCopterSection(props: AutotuneCopterSectionProps): ReactElement | null {
  const { snapshot, editedValues, parameterDraftById, setDraft } = props

  // Resolve paramIds to live ParameterState, dropping any the controller does
  // not stream — same omit-if-missing behaviour as the tuning sections.
  const parameters: ParameterState[] = AUTOTUNE_COPTER_PARAM_IDS.map((id) =>
    selectParameterById(snapshot, id)
  ).filter((parameter): parameter is ParameterState => parameter !== undefined)

  // If the connected FC does not stream any AUTOTUNE_* params (no AutoTune
  // support in the build), render nothing rather than an empty card.
  if (parameters.length === 0) {
    return null
  }

  // Same value shape as the Pilot cards; edits stage through the shared draft
  // set and go out from the draft bar like every other tab.
  const valueFor = (parameter: ParameterState): PilotFeelValue => {
    const named = parameter.definition?.options ?? []
    const value: PilotFeelValue = {
      paramId: parameter.id,
      label: LABELS[parameter.id] ?? parameter.definition?.label ?? parameter.id,
      description: parameter.definition?.description,
      unit: parameter.definition?.unit,
      text: editedValues[parameter.id] ?? formatNumericDisplayValue(parameter.value),
      draftStatus: parameterDraftById.get(parameter.id)?.status,
      min: parameter.definition?.minimum,
      max: parameter.definition?.maximum,
      onChange: (next) => setDraft(parameter.id, next)
    }
    if (parameter.definition?.bitmask && named.length > 0) {
      return { ...value, bits: named.map((option) => ({ bit: option.value, label: option.label })) }
    }
    return value
  }

  return (
    <section className="bf-gui-box pilot-feel-card" data-testid="autotune-copter-section">
      <div className="bf-gui-box__titlebar">
        <strong>AutoTune</strong>
      </div>
      <div className="bf-gui-box__body">
        <div data-testid="autotune-copter-config-group">
          <FeelGrid
            testId="autotune-copter-grid"
            columns={['']}
            rows={parameters.map((parameter) => ({ label: LABELS[parameter.id] ?? parameter.id, cells: [valueFor(parameter)] }))}
          />
        </div>

        <div data-testid="autotune-copter-procedure">
          <p className="bf-note bf-note--warning" data-testid="autotune-copter-safety">
            Save a known-good snapshot first, and fly in open, calm airspace — AutoTune twitches the aircraft hard on
            each axis.
          </p>
          <details className="calibration-card__howto" data-testid="autotune-copter-procedure-details">
            <summary>How to run AutoTune</summary>
            <ol>
              <li>Assign an RC switch to AutoTune (RC<em>n</em>_OPTION = 17).</li>
              <li>Take off, settle in AltHold (it needs the steady hover), then switch AutoTune on. Each selected axis takes a few minutes.</li>
              <li>To keep the new gains: leave the switch on, land and disarm.</li>
              <li>To discard them: switch AutoTune off before disarming.</li>
            </ol>
          </details>
        </div>
      </div>
    </section>
  )
}
