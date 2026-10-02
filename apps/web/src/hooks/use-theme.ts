import { useTheme as useKitTheme, type UseThemeResult } from '@arduconfig/ui-kit'

import { THEME_STORAGE_KEY } from '../theme'

export type { UseThemeResult } from '@arduconfig/ui-kit'

/** React state around the persisted UI theme. main.tsx applies the initial
 *  theme before render; this keeps React in step and drives the toggle. */
export function useTheme(): UseThemeResult {
  return useKitTheme(THEME_STORAGE_KEY)
}
