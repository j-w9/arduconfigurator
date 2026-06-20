import type {
  AppViewDefinition,
  FirmwareMetadataBundle,
  NormalizedFirmwareMetadataBundle,
  NormalizedParameterDefinition,
  NormalizedPresetDefinition,
  ParameterCategoryDefinition
} from './types.js'

const DEFAULT_APP_VIEWS: AppViewDefinition[] = [
  {
    id: 'setup',
    label: 'Setup',
    description: 'Connection, identity, and calibration surfaces.',
    order: 1
  },
  {
    id: 'ports',
    label: 'Ports',
    description: 'Serial roles, GPS links, and peripheral setup.',
    order: 2
  },
  {
    id: 'vtx',
    label: 'VTX',
    description: 'Video transmitter control, channel, and power setup.',
    order: 3
  },
  {
    id: 'osd',
    label: 'OSD',
    description: 'FPV overlay backend, screen mode, and display-page setup.',
    order: 4
  },
  {
    id: 'receiver',
    label: 'Receiver',
    description: 'RC mapping, ranges, and mode-switch setup.',
    order: 5
  },
  {
    id: 'modes',
    label: 'Modes',
    description: 'Flight-mode switch assignments and live position.',
    order: 6
  },
  {
    id: 'motors',
    label: 'Motors',
    description: 'Frame class, motor mapping, direction tests, ESC protocol, and verification review.',
    order: 7
  },
  {
    id: 'servos',
    label: 'Servos',
    description: 'Peripheral servo function assignments — gimbal, parachute, gripper, and other aux outputs.',
    order: 7.5
  },
  {
    id: 'power',
    label: 'Power',
    description: 'Battery, failsafe, and pre-arm review.',
    order: 8
  },
  {
    id: 'failsafe',
    label: 'Failsafe',
    description: 'RC, battery, and advanced failsafe overview.',
    order: 9
  },
  {
    id: 'snapshots',
    label: 'Snapshots',
    description: 'Capture, compare, and restore known-good parameter sets.',
    order: 10
  },
  {
    id: 'tuning',
    label: 'Tuning',
    description: 'Beginner-safe flight-feel and acro-rate tuning.',
    order: 11
  },
  {
    id: 'presets',
    label: 'Presets',
    description: 'Curated, explainable tuning bundles with automatic backup.',
    order: 12
  },
  {
    id: 'config',
    label: 'Config',
    description: 'Baseline misc — board orientation, arming behavior, system identity, statistics.',
    order: 12.5
  },
  {
    id: 'parameters',
    label: 'Parameters',
    description: 'Low-level parameter editing, diffing, and backup work.',
    order: 13
  }
]

function fallbackCategoryDefinition(categoryId: string): ParameterCategoryDefinition {
  return {
    id: categoryId,
    label: startCase(categoryId),
    description: `${startCase(categoryId)} parameters.`,
    order: 999,
    viewId: 'parameters'
  }
}

function fallbackPresetGroupDefinition(groupId: string) {
  return {
    id: groupId,
    label: startCase(groupId),
    description: `${startCase(groupId)} presets.`,
    order: 999
  }
}

export function normalizeFirmwareMetadata(bundle: FirmwareMetadataBundle): NormalizedFirmwareMetadataBundle {
  const appViews = [...(bundle.appViews ?? DEFAULT_APP_VIEWS)].sort((left, right) => left.order - right.order)
  const categoryById = { ...(bundle.categories ?? {}) }
  const presetGroupById = { ...(bundle.presetGroups ?? {}) }

  const parameters = Object.fromEntries(
    Object.entries(bundle.parameters).map(([parameterId, definition]) => {
      const categoryDefinition = categoryById[definition.category] ?? fallbackCategoryDefinition(definition.category)
      categoryById[definition.category] = categoryDefinition

      const normalizedDefinition: NormalizedParameterDefinition = {
        ...definition,
        categoryDefinition
      }

      return [parameterId, normalizedDefinition]
    })
  ) as Record<string, NormalizedParameterDefinition>

  const presets = Object.values(bundle.presets ?? {})
    .map<NormalizedPresetDefinition>((preset) => {
      const groupDefinition = presetGroupById[preset.groupId] ?? fallbackPresetGroupDefinition(preset.groupId)
      presetGroupById[preset.groupId] = groupDefinition

      return {
        ...preset,
        groupDefinition,
        tags: [...new Set((preset.tags ?? []).map((tag) => tag.trim()).filter((tag) => tag.length > 0))]
      }
    })
    .sort(
      (left, right) =>
        left.groupDefinition.order - right.groupDefinition.order ||
        left.order - right.order ||
        left.label.localeCompare(right.label)
    )

  const categories = Object.values(categoryById).sort((left, right) => left.order - right.order || left.label.localeCompare(right.label))
  const presetGroups = Object.values(presetGroupById).sort(
    (left, right) => left.order - right.order || left.label.localeCompare(right.label)
  )
  const parametersByCategory = categories.reduce<Record<string, NormalizedParameterDefinition[]>>((grouped, category) => {
    grouped[category.id] = Object.values(parameters)
      .filter((definition) => definition.category === category.id)
      .sort((left, right) => left.id.localeCompare(right.id))
    return grouped
  }, {})
  const presetsByGroup = presetGroups.reduce<Record<string, NormalizedPresetDefinition[]>>((grouped, group) => {
    grouped[group.id] = presets
      .filter((preset) => preset.groupId === group.id)
      .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label))
    return grouped
  }, {})

  return {
    firmware: bundle.firmware,
    appViews,
    categories,
    categoryById,
    presetGroups,
    presetGroupById,
    presets,
    presetsByGroup,
    parameters,
    parametersByCategory
  }
}

function startCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase())
}
