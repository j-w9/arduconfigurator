// Find a setting by name: a tab, a Config / Peripherals section, or a
// parameter, and where it lives.
//
// The rail is filtered by role (view-roles.ts), so "where did my tab go" needs
// an answer that is not a secret menu. This is it: type what you remember
// from the old tool -- a tab, a card title, a parameter id -- and the result
// names the tab and opens it. Expert-only tabs are not offered outside Expert
// mode, as they are not reachable there either.
//
// Pure: App.tsx builds the index from the view list, the section lists and the
// parameter catalog, and the search is a function of the index and the query.

import type { AppViewId } from '@arduconfig/param-metadata'

import { isExpertOnlyView } from '../guided-setup-shortcut'
import type { ConfigCategoryId } from '../views/Config'

export type FeatureSearchKind = 'tab' | 'section' | 'parameter'

export interface FeatureSearchEntry {
  key: string
  kind: FeatureSearchKind
  /** What the result says: the tab, the section title or the parameter id. */
  label: string
  /** Where it lives, for the line under the label: "Config › Airframe & Powertrain". */
  detail: string
  viewId: AppViewId
  /** The Config / Peripherals category to open first. */
  configCategory?: ConfigCategoryId
  /** The section card to scroll to (data-testid="config-section-<id>"). */
  sectionId?: string
  paramId?: string
  /** Lowercased text the query is matched against. */
  haystack: string
}

/** A result; `needsExpert` when it lives on an Expert-only tab and Expert is off. */
export type FeatureSearchResult = FeatureSearchEntry & { needsExpert?: boolean }

export interface FeatureSearchView {
  id: AppViewId
  label: string
  description?: string
}

export interface FeatureSearchSection {
  id: string
  title: string
  description?: string
  category?: ConfigCategoryId
  fields?: readonly { paramId: string; label?: string }[]
  /** 'config' or 'peripherals': which ConfigView renders it. */
  viewId: 'config' | 'peripherals'
}

export interface FeatureSearchParameter {
  id: string
  label?: string
  description?: string
  category?: string
}

export interface FeatureSearchIndexInputs {
  /** Every tab the app has, whatever the mode (the Expert rail). */
  views: readonly FeatureSearchView[]
  sections: readonly FeatureSearchSection[]
  categoryLabels: Readonly<Record<string, string>>
  parameters: readonly FeatureSearchParameter[]
  /** The parameter catalog's category -> tab mapping. */
  parameterCategoryViews: Readonly<Record<string, AppViewId | undefined>>
}

/**
 * Parameter categories the catalog still files under a tab they left. The
 * rangefinder and optical-flow drivers live on Peripherals ▸ Flow & Lidar.
 */
const CATEGORY_HOMES: Readonly<Record<string, { viewId: AppViewId; configCategory?: ConfigCategoryId }>> = {
  rangefinder: { viewId: 'peripherals', configCategory: 'flow-lidar' },
  'optical-flow': { viewId: 'peripherals', configCategory: 'flow-lidar' }
}

/** Tabs the catalog still names that are categories of another tab now. */
const LEGACY_VIEW_HOMES: Partial<Record<AppViewId, { viewId: AppViewId; configCategory?: ConfigCategoryId }>> = {
  power: { viewId: 'config', configCategory: 'power' },
  modes: { viewId: 'config', configCategory: 'flight-modes' },
  vtx: { viewId: 'osd' }
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[_\-./]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function haystackOf(...parts: (string | undefined)[]): string {
  return normalize(parts.filter((part): part is string => Boolean(part)).join(' '))
}

export function buildFeatureSearchIndex(inputs: FeatureSearchIndexInputs): FeatureSearchEntry[] {
  const viewLabel = new Map(inputs.views.map((view) => [view.id, view.label]))
  const entries: FeatureSearchEntry[] = []

  for (const view of inputs.views) {
    entries.push({
      key: `tab:${view.id}`,
      kind: 'tab',
      label: view.label,
      detail: 'Tab',
      viewId: view.id,
      haystack: haystackOf(view.label, view.id, view.description)
    })
  }

  // A parameter that a section renders belongs to that section, which is a
  // better answer than its catalog category: it names the card to look at.
  const sectionByParam = new Map<string, FeatureSearchEntry>()
  for (const section of inputs.sections) {
    const categoryLabel = section.category ? inputs.categoryLabels[section.category] : undefined
    const entry: FeatureSearchEntry = {
      key: `section:${section.viewId}:${section.id}`,
      kind: 'section',
      label: section.title,
      detail: [viewLabel.get(section.viewId) ?? section.viewId, categoryLabel].filter(Boolean).join(' › '),
      viewId: section.viewId,
      configCategory: section.category,
      sectionId: section.id,
      haystack: haystackOf(
        section.title,
        section.description,
        ...(section.fields ?? []).flatMap((field) => [field.paramId, field.label])
      )
    }
    entries.push(entry)
    for (const field of section.fields ?? []) {
      if (!sectionByParam.has(field.paramId)) sectionByParam.set(field.paramId, entry)
    }
  }

  for (const parameter of inputs.parameters) {
    const home = sectionByParam.get(parameter.id)
    let viewId: AppViewId
    let configCategory: ConfigCategoryId | undefined
    let sectionId: string | undefined
    if (home) {
      viewId = home.viewId
      configCategory = home.configCategory
      sectionId = home.sectionId
    } else {
      const categoryHome = parameter.category ? CATEGORY_HOMES[parameter.category] : undefined
      const catalogView = (parameter.category && inputs.parameterCategoryViews[parameter.category]) || 'parameters'
      const legacy = LEGACY_VIEW_HOMES[catalogView]
      viewId = categoryHome?.viewId ?? legacy?.viewId ?? catalogView
      configCategory = categoryHome?.configCategory ?? legacy?.configCategory
    }
    if (!viewLabel.has(viewId)) {
      // A tab that is not in the app (hidden for everyone): raw Parameters is
      // the honest home.
      viewId = 'parameters'
      configCategory = undefined
      sectionId = undefined
    }
    const where = home ? home.detail + ' › ' + home.label : viewLabel.get(viewId) ?? viewId
    entries.push({
      key: `param:${parameter.id}`,
      kind: 'parameter',
      label: parameter.id,
      detail: parameter.label ? `${parameter.label} · ${where}` : where,
      viewId,
      configCategory,
      sectionId,
      paramId: parameter.id,
      haystack: haystackOf(parameter.id, parameter.label, parameter.description)
    })
  }

  return entries
}

const KIND_RANK: Record<FeatureSearchKind, number> = { tab: 0, section: 1, parameter: 2 }

/** 0 = the label or id is the query; 1 = starts with it; 2 = a word starts
 *  with it; 3 = it is in there somewhere; undefined = no match. */
function scoreOf(entry: FeatureSearchEntry, query: string, tokens: readonly string[]): number | undefined {
  const label = normalize(entry.label)
  if (label === query) return 0
  if (label.startsWith(query)) return 1
  if (!tokens.every((token) => entry.haystack.includes(token))) return undefined
  if (tokens.every((token) => label.split(' ').some((word) => word.startsWith(token)))) return 2
  return 3
}

export function searchFeatures(
  index: readonly FeatureSearchEntry[],
  rawQuery: string,
  options: { isExpertMode: boolean; limit?: number }
): FeatureSearchResult[] {
  const query = normalize(rawQuery)
  if (query === '') return []
  const tokens = query.split(' ')
  const limit = options.limit ?? 8

  const scored: { entry: FeatureSearchEntry; score: number; needsExpert: boolean }[] = []
  for (const entry of index) {
    // Outside Expert, a result on an Expert-only tab is still offered (so a
    // search for "lua" finds Lua Scripts) but marked: opening it turns Expert
    // mode on. It ranks after everything that opens as it is.
    const needsExpert = isExpertOnlyView(entry.viewId) && !options.isExpertMode
    const score = scoreOf(entry, query, tokens)
    if (score !== undefined) scored.push({ entry, score, needsExpert })
  }
  scored.sort(
    (left, right) =>
      Number(left.needsExpert && left.score > 1) - Number(right.needsExpert && right.score > 1) ||
      left.score - right.score ||
      KIND_RANK[left.entry.kind] - KIND_RANK[right.entry.kind] ||
      left.entry.label.length - right.entry.label.length ||
      left.entry.label.localeCompare(right.entry.label)
  )
  return scored.slice(0, limit).map(({ entry, needsExpert }) => (needsExpert ? { ...entry, needsExpert } : entry))
}
