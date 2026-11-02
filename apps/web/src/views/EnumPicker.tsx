import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'

export interface EnumPickerOption {
  value: number
  label: string
}

/**
 * A dropdown for a named-value parameter that stays inside the app window.
 *
 * A native `<select>` with eighty servo functions opens the OS menu, which
 * runs past the top and bottom of the window. This one opens a panel under
 * (or, short of room, above) the trigger, sized to the viewport, with a
 * search box: type "motor" and the list is the eight motor functions.
 *
 * `value` is the raw value as text (what the draft holds); a value no option
 * names shows as "Other: N" and stays pickable so an unknown value is never
 * silently replaced.
 */
export function EnumPicker(props: {
  value: string
  options: ReadonlyArray<EnumPickerOption>
  onChange: (next: string) => void
  disabled?: boolean
  invalid?: boolean
  testId?: string
  ariaLabel?: string
}): ReactElement {
  const { value, options, onChange, disabled, invalid, testId, ariaLabel } = props
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({})

  const current = options.find((option) => String(option.value) === value)
  const triggerLabel = current ? `${current.label} (${current.value})` : value === '' ? '—' : `Other: ${value}`

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return options
    return options.filter(
      (option) => option.label.toLowerCase().includes(needle) || String(option.value) === needle
    )
  }, [options, query])

  // Place the panel: below the trigger when it fits, else above; never wider
  // than the window, never taller than the room it has. Returns false when
  // the trigger is out of the window (the panel then closes).
  const place = (): boolean => {
    const trigger = triggerRef.current
    if (!trigger) return false
    const rect = trigger.getBoundingClientRect()
    const margin = 8
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth
    if (rect.bottom < 0 || rect.top > viewportHeight) return false
    const below = viewportHeight - rect.bottom - margin
    const above = rect.top - margin
    const wanted = 320
    const openBelow = below >= Math.min(wanted, above)
    const maxHeight = Math.max(120, Math.min(wanted, openBelow ? below : above))
    const width = Math.min(Math.max(rect.width, 260), viewportWidth - 2 * margin)
    const left = Math.min(Math.max(margin, rect.left), viewportWidth - margin - width)
    setPanelStyle(
      openBelow
        ? { position: 'fixed', top: rect.bottom + 2, left, width, maxHeight }
        : { position: 'fixed', bottom: viewportHeight - rect.top + 2, left, width, maxHeight }
    )
    return true
  }

  useLayoutEffect(() => {
    if (!open) return
    place()
    const initial = Math.max(0, filtered.findIndex((option) => String(option.value) === value))
    setActive(initial)
    searchRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || listRef.current?.parentElement?.contains(target)) return
      close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey)
    // The page scrolls under a fixed panel (the operator's wheel, or live
    // content above growing): follow the trigger; close once it leaves the
    // window. The list's own scroll is ignored.
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && listRef.current?.contains(event.target)) return
      if (!place()) close()
    }
    window.addEventListener('resize', onScroll)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onScroll)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    // Scroll the list only: scrollIntoView would also scroll the page under
    // the fixed panel, which closes it.
    const list = listRef.current
    const item = list?.children[active] as HTMLElement | undefined
    if (!list || !item) return
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight
    }
  }, [active, open])

  const pick = (option: EnumPickerOption) => {
    onChange(String(option.value))
    setOpen(false)
    setQuery('')
    triggerRef.current?.focus()
  }

  return (
    <div className={`enum-picker${open ? ' is-open' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className={`enum-picker__trigger${invalid ? ' enum-picker__trigger--invalid' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        data-testid={testId}
        data-value={value}
        onClick={() => {
          setQuery('')
          setOpen((was) => !was)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setQuery('')
            setOpen(true)
          }
        }}
      >
        <span className="enum-picker__label">{triggerLabel}</span>
        <span className="enum-picker__chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div className="enum-picker__panel" style={panelStyle} data-testid={testId ? `${testId}-panel` : undefined}>
          <input
            ref={searchRef}
            type="search"
            className="enum-picker__search"
            placeholder="Search"
            value={query}
            autoComplete="off"
            data-testid={testId ? `${testId}-search` : undefined}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive((index) => Math.min(filtered.length - 1, index + 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((index) => Math.max(0, index - 1))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                const option = filtered[active]
                if (option) pick(option)
              }
            }}
          />
          <ul ref={listRef} className="enum-picker__list" role="listbox" aria-label={ariaLabel}>
            {filtered.length === 0 ? <li className="enum-picker__empty">No match</li> : null}
            {filtered.map((option, index) => {
              const selected = String(option.value) === value
              return (
                <li
                  key={option.value}
                  role="option"
                  aria-selected={selected}
                  className={`enum-picker__option${index === active ? ' is-active' : ''}${selected ? ' is-selected' : ''}`}
                  data-testid={testId ? `${testId}-option-${option.value}` : undefined}
                  onMouseEnter={() => setActive(index)}
                  // mousedown + preventDefault keeps focus in the panel through the pick.
                  onMouseDown={(event) => {
                    event.preventDefault()
                    pick(option)
                  }}
                >
                  <span className="enum-picker__option-label">{option.label}</span>
                  <span className="enum-picker__option-value">{option.value}</span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
