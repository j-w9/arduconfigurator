// Board photo / variant picker state, extracted from App.tsx as part of its
// decomposition. Owns the lightbox selection (with Escape-to-close), the chosen
// hardware variant id, and the resolved variant for the Ports board card.
// Behavior-neutral lift of the original App() hooks (same dependency arrays).

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

import type { BoardMediaAsset, BoardVariant } from '@arduconfig/param-metadata'

export interface UseBoardMediaPickerResult {
  selectedBoardMedia: BoardMediaAsset | undefined
  setSelectedBoardMedia: Dispatch<SetStateAction<BoardMediaAsset | undefined>>
  selectedBoardVariantId: string | undefined
  setSelectedBoardVariantId: Dispatch<SetStateAction<string | undefined>>
  selectedBoardVariant: BoardVariant | undefined
}

export function useBoardMediaPicker(boardVariants: readonly BoardVariant[]): UseBoardMediaPickerResult {
  const [selectedBoardMedia, setSelectedBoardMedia] = useState<BoardMediaAsset>()
  const [selectedBoardVariantId, setSelectedBoardVariantId] = useState<string>()
  const selectedBoardVariant =
    boardVariants.find((variant) => variant.id === selectedBoardVariantId) ?? boardVariants[0]

  // Close the board-photo lightbox on Escape.
  useEffect(() => {
    if (!selectedBoardMedia || typeof window === 'undefined') {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedBoardMedia(undefined)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [selectedBoardMedia])

  return {
    selectedBoardMedia,
    setSelectedBoardMedia,
    selectedBoardVariantId,
    setSelectedBoardVariantId,
    selectedBoardVariant
  }
}
