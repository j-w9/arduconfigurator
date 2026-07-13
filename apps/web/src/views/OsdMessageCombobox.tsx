import { useMemo, useState } from 'react'
import type { ReactElement } from 'react'

import type { OsdCatalogEntry } from '../view-models/osd-message-suggestions'

/** Cap the rendered rows — the catalog is ~800 unique keys; search narrows it. */
const MAX_ROWS = 50

/**
 * Searchable combobox for the OSD shorthand "from" field. Filters the firmware
 * message catalog by full label OR key as you type, and inserts the ≤15-char
 * `from` key on select. Stays free-text: typing sets the raw value (capped to
 * maxLength), so a fragment that isn't in the catalog is still valid.
 */
export function OsdMessageCombobox(props: {
  value: string
  onChange: (next: string) => void
  suggestions: readonly OsdCatalogEntry[]
  maxLength: number
  disabled?: boolean
  testId?: string
  ariaLabel?: string
}): ReactElement {
  const { value, onChange, suggestions, maxLength, disabled, testId, ariaLabel } = props
  const [open, setOpen] = useState(false)

  const filtered = useMemo(() => {
    const query = value.trim().toLowerCase()
    const matches = query
      ? suggestions.filter(
          (entry) => entry.label.toLowerCase().includes(query) || entry.from.toLowerCase().includes(query)
        )
      : suggestions
    return matches.slice(0, MAX_ROWS)
  }, [value, suggestions])

  return (
    <div className="osd-combobox">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-label={ariaLabel}
        data-testid={testId}
        value={value}
        placeholder="Search messages, or type a fragment"
        maxLength={maxLength}
        disabled={disabled}
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value.slice(0, maxLength))
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        // Defer close so a click on an option registers first.
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      />
      {open && filtered.length > 0 ? (
        <ul className="osd-combobox__list" role="listbox">
          {filtered.map((entry) => (
            <li
              key={`${entry.from}::${entry.label}`}
              role="option"
              aria-selected={value === entry.from}
              className="osd-combobox__option"
              data-testid={testId ? `${testId}-option` : undefined}
              // mousedown + preventDefault so the input keeps focus through the pick.
              onMouseDown={(event) => {
                event.preventDefault()
                onChange(entry.from)
                setOpen(false)
              }}
            >
              <span className="osd-combobox__label">{entry.label}</span>
              <span className="osd-combobox__from">{entry.from}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
