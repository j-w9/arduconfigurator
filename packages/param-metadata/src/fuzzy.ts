// Lightweight fuzzy matcher for the parameter search box. Returns a score
// (higher = better) when every character of `query` appears in `target` in
// order (a subsequence match), or null when it doesn't. Scoring rewards
// matches that are contiguous, that start a word (after a separator, or the
// first char), and that occur earlier — so "btvolt" ranks BATT_VOLT above an
// incidental scatter match. Case-insensitive.

const WORD_BOUNDARY = /[^a-z0-9]/i

export function fuzzyScore(query: string, target: string): number | null {
  const q = query.trim().toLowerCase()
  if (q.length === 0) {
    return 0
  }
  const t = target.toLowerCase()
  if (t.length === 0) {
    return null
  }
  // Fast path: a contiguous substring is the strongest signal.
  const substringIndex = t.indexOf(q)
  if (substringIndex !== -1) {
    // Big base for substring, bonus for matching at a word boundary and
    // for matching earlier in the string.
    const atBoundary = substringIndex === 0 || WORD_BOUNDARY.test(t[substringIndex - 1])
    return 1000 + (atBoundary ? 300 : 0) + Math.max(0, 100 - substringIndex) + q.length
  }

  // Subsequence match with contiguity + boundary bonuses.
  let score = 0
  let queryIdx = 0
  let lastMatch = -2
  for (let i = 0; i < t.length && queryIdx < q.length; i += 1) {
    if (t[i] !== q[queryIdx]) {
      continue
    }
    let charScore = 1
    if (i === lastMatch + 1) {
      charScore += 5 // contiguous with the previous matched char
    }
    if (i === 0 || WORD_BOUNDARY.test(t[i - 1])) {
      charScore += 3 // start of a word
    }
    score += charScore
    lastMatch = i
    queryIdx += 1
  }
  if (queryIdx < q.length) {
    return null // not all query chars matched in order
  }
  // Prefer shorter targets (denser matches) and earlier first match.
  return score + Math.max(0, 20 - t.length / 4)
}

/**
 * Best fuzzy score of `query` across several fields (e.g. a param id + its
 * label), or null if none match.
 */
export function fuzzyScoreFields(query: string, fields: ReadonlyArray<string | undefined>): number | null {
  let best: number | null = null
  for (const field of fields) {
    if (field === undefined) {
      continue
    }
    const score = fuzzyScore(query, field)
    if (score !== null && (best === null || score > best)) {
      best = score
    }
  }
  return best
}
