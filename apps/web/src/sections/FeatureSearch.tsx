// Find a setting: the box at the top of the rail. Type a tab, a card title or
// a parameter id and pick where to go. The matching is in
// view-models/feature-search.ts; this is the input, the list and the keys.

import { useEffect, useMemo, useState, type ReactElement } from 'react'

import { searchFeatures, type FeatureSearchEntry, type FeatureSearchResult } from '../view-models/feature-search'

export interface FeatureSearchProps {
  index: readonly FeatureSearchEntry[]
  isExpertMode: boolean
  onOpen: (entry: FeatureSearchResult) => void
}

export function FeatureSearch({ index, isExpertMode, onOpen }: FeatureSearchProps): ReactElement {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const results = useMemo(() => searchFeatures(index, query, { isExpertMode }), [index, query, isExpertMode])
  const open = query.trim() !== ''

  useEffect(() => setCursor(0), [query])

  const pick = (result: FeatureSearchResult | undefined): void => {
    if (!result) return
    onOpen(result)
    setQuery('')
  }

  return (
    <div className="feature-search" data-testid="feature-search">
      <input
        type="search"
        className="feature-search__input"
        value={query}
        placeholder="Find a setting"
        aria-label="Find a setting: a tab, a card or a parameter"
        spellCheck={false}
        autoComplete="off"
        data-testid="feature-search-input"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setCursor((current) => Math.min(current + 1, Math.max(results.length - 1, 0)))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setCursor((current) => Math.max(current - 1, 0))
          } else if (event.key === 'Enter') {
            event.preventDefault()
            pick(results[cursor])
          } else if (event.key === 'Escape') {
            setQuery('')
          }
        }}
      />
      {open && results.length === 0 ? (
        <p className="feature-search__empty" data-testid="feature-search-empty">
          Nothing called “{query.trim()}”.
        </p>
      ) : null}
      {open && results.length > 0 ? (
        <ul className="feature-search__results" role="listbox" data-testid="feature-search-results">
          {results.map((result, position) => (
            <li key={result.key}>
              <button
                type="button"
                role="option"
                aria-selected={position === cursor}
                className={`feature-search__result${position === cursor ? ' is-active' : ''}`}
                data-testid={`feature-search-result-${result.key}`}
                // Keep the input's focus so Escape and the arrows keep working
                // after a hover; the click still fires.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setCursor(position)}
                onClick={() => pick(result)}
              >
                <strong>{result.label}</strong>
                <small>{result.detail}</small>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
