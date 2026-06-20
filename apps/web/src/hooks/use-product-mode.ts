import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

export type ProductMode = 'basic' | 'expert'

const PRODUCT_MODE_STORAGE_KEY = 'arduconfig:product-mode'

function readStoredProductMode(): ProductMode {
  if (typeof window === 'undefined') {
    return 'basic'
  }

  try {
    const stored = window.sessionStorage.getItem(PRODUCT_MODE_STORAGE_KEY)
    return stored === 'expert' ? 'expert' : 'basic'
  } catch {
    return 'basic'
  }
}

/**
 * Owns the product-mode (basic / expert) state plus its sessionStorage
 * persistence. Extracted verbatim from App.tsx; the returned tuple matches
 * the previous `useState` signature so every consumer is unchanged.
 */
export function useProductMode(): [ProductMode, Dispatch<SetStateAction<ProductMode>>] {
  const [productMode, setProductMode] = useState<ProductMode>(readStoredProductMode)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    try {
      window.sessionStorage.setItem(PRODUCT_MODE_STORAGE_KEY, productMode)
    } catch {
      // Ignore session storage failures; the mode still applies for the current render tree.
    }
  }, [productMode])

  return [productMode, setProductMode]
}
