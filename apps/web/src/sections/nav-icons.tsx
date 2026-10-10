// Sidebar icons: one small symbol per tab, beside its label.
//
// Path data from Lucide (lucide-static 0.460.0), ISC License:
//   Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of
//   Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.
//   Permission to use, copy, modify, and/or distribute this software for any purpose with
//   or without fee is hereby granted, provided that the above copyright notice and this
//   permission notice appear in all copies. THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR
//   DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE.
// Copied as markup (not a dependency) for the few icons the sidebar uses.

import type { ReactElement } from 'react'

const ICON_MARKUP: Record<string, string> = {
  'activity': '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />',
  'battery-charging': '<path d="M15 7h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2" /> <path d="M6 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1" /> <path d="m11 7-3 5h4l-3 5" /> <line x1="22" x2="22" y1="11" y2="13" />',
  'bookmark': '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />',
  'cable': '<path d="M17 21v-2a1 1 0 0 1-1-1v-1a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1" /> <path d="M19 15V6.5a1 1 0 0 0-7 0v11a1 1 0 0 1-7 0V9" /> <path d="M21 21v-2h-4" /> <path d="M3 5h4V3" /> <path d="M7 5a1 1 0 0 1 1 1v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1V3" />',
  'camera': '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /> <circle cx="12" cy="13" r="3" />',
  'code-xml': '<path d="m18 16 4-4-4-4" /> <path d="m6 8-4 4 4 4" /> <path d="m14.5 4-5 16" />',
  'compass': '<path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z" /> <circle cx="12" cy="12" r="10" />',
  'crosshair': '<circle cx="12" cy="12" r="10" /> <line x1="22" x2="18" y1="12" y2="12" /> <line x1="6" x2="2" y1="12" y2="12" /> <line x1="12" x2="12" y1="6" y2="2" /> <line x1="12" x2="12" y1="22" y2="18" />',
  'fan': '<path d="M10.827 16.379a6.082 6.082 0 0 1-8.618-7.002l5.412 1.45a6.082 6.082 0 0 1 7.002-8.618l-1.45 5.412a6.082 6.082 0 0 1 8.618 7.002l-5.412-1.45a6.082 6.082 0 0 1-7.002 8.618l1.45-5.412Z" /> <path d="M12 12v.01" />',
  'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /> <path d="M14 2v4a2 2 0 0 0 2 2h4" /> <path d="M10 9H8" /> <path d="M16 13H8" /> <path d="M16 17H8" />',
  'folder': '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />',
  'gauge': '<path d="m12 14 4-4" /> <path d="M3.34 19a10 10 0 1 1 17.32 0" />',
  'globe': '<circle cx="12" cy="12" r="10" /> <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /> <path d="M2 12h20" />',
  'list': '<path d="M3 12h.01" /> <path d="M3 18h.01" /> <path d="M3 6h.01" /> <path d="M8 12h13" /> <path d="M8 18h13" /> <path d="M8 6h13" />',
  'monitor': '<rect width="20" height="14" x="2" y="3" rx="2" /> <line x1="8" x2="16" y1="21" y2="21" /> <line x1="12" x2="12" y1="17" y2="21" />',
  'network': '<rect x="16" y="16" width="6" height="6" rx="1" /> <rect x="2" y="16" width="6" height="6" rx="1" /> <rect x="9" y="2" width="6" height="6" rx="1" /> <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" /> <path d="M12 12V8" />',
  'plug': '<path d="M12 22v-5" /> <path d="M9 8V2" /> <path d="M15 8V2" /> <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />',
  'radio': '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" /> <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" /> <circle cx="12" cy="12" r="2" /> <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" /> <path d="M19.1 4.9C23 8.8 23 15.1 19.1 19" />',
  'rotate-cw': '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /> <path d="M21 3v5h-5" />',
  'scan-search': '<path d="M3 7V5a2 2 0 0 1 2-2h2" /> <path d="M17 3h2a2 2 0 0 1 2 2v2" /> <path d="M21 17v2a2 2 0 0 1-2 2h-2" /> <path d="M7 21H5a2 2 0 0 1-2-2v-2" /> <circle cx="12" cy="12" r="3" /> <path d="m16 16-1.9-1.9" />',
  'shield-alert': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /> <path d="M12 8v4" /> <path d="M12 16h.01" />',
  'shuffle': '<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22" /> <path d="m18 2 4 4-4 4" /> <path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2" /> <path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8" /> <path d="m18 14 4 4-4 4" />',
  'sliders-horizontal': '<line x1="21" x2="14" y1="4" y2="4" /> <line x1="10" x2="3" y1="4" y2="4" /> <line x1="21" x2="12" y1="12" y2="12" /> <line x1="8" x2="3" y1="12" y2="12" /> <line x1="21" x2="16" y1="20" y2="20" /> <line x1="12" x2="3" y1="20" y2="20" /> <line x1="14" x2="14" y1="2" y2="6" /> <line x1="8" x2="8" y1="10" y2="14" /> <line x1="16" x2="16" y1="18" y2="22" />',
  'sparkles': '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" /> <path d="M20 3v4" /> <path d="M22 5h-4" /> <path d="M4 17v2" /> <path d="M5 18H3" />',
  'toggle-right': '<rect width="20" height="12" x="2" y="6" rx="6" ry="6" /> <circle cx="16" cy="12" r="2" />',
  'zap': '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />',
}

const VIEW_ICON: Record<string, string> = {
  'setup': 'activity',
  'guided-setup': 'compass',
  'config': 'sliders-horizontal',
  'peripherals': 'plug',
  'calibration': 'crosshair',
  'ports': 'cable',
  'receiver': 'radio',
  'modes': 'toggle-right',
  'motors': 'fan',
  'servos': 'rotate-cw',
  'power': 'battery-charging',
  'failsafe': 'shield-alert',
  'osd': 'monitor',
  'vtx': 'monitor',
  'tuning': 'gauge',
  'presets': 'bookmark',
  'snapshots': 'camera',
  'logs': 'file-text',
  'parameters': 'list',
  'can': 'network',
  'networking': 'globe',
  'files': 'folder',
  'lua': 'code-xml',
  'flash': 'zap',
  'elrs-flash': 'zap',
  'rc-mixer': 'shuffle',
  'mavlink-inspector': 'scan-search',
  'ai-assistant': 'sparkles',
}

/** The tab's icon (a neutral dot for a tab without one). Decorative: the label names the tab. */
export function NavIcon({ viewId }: { viewId: string }): ReactElement {
  const markup = ICON_MARKUP[VIEW_ICON[viewId] ?? '']
  return (
    <svg
      className="workspace-nav__icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      // Static, vetted path data from the table above -- never user input.
      dangerouslySetInnerHTML={{ __html: markup ?? '<circle cx="12" cy="12" r="2" />' }}
    />
  )
}
