import { useCallback, useEffect, useState } from 'react'

import { uploadArtifact, LogServerError, type ArtifactUploadMetadata } from '../log-upload/client'
import { clearLogServerSession, loadLogServerSession } from '../log-upload/session-storage'

/**
 * Upload a configuration export to the operator's own ArduLogs server.
 *
 * Reuses the session the Logs tab already established rather than asking for
 * credentials again — an operator who signed in to upload a flight should not
 * sign in a second time to upload the tune that flew it. Which is the point of
 * this: a parameter backup filed next to the flights it produced answers
 * "the tune changed and the next flight oscillated", and neither half is much
 * use on its own.
 *
 * The export text is passed through verbatim. It is never parsed and
 * re-serialised on the way out: that would reformat the operator's file, and
 * the server's sha256 is over exactly the bytes sent.
 */
export type ArtifactUploadStatus =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string }

export interface ArtifactUpload {
  /** True only when a log-server session exists — no session, no button. */
  available: boolean
  serverUrl?: string
  status: ArtifactUploadStatus
  upload: (metadata: ArtifactUploadMetadata, content: string) => Promise<void>
  reset: () => void
}

export function useArtifactUpload(): ArtifactUpload {
  const [session, setSession] = useState(() => loadLogServerSession())
  const [status, setStatus] = useState<ArtifactUploadStatus>({ kind: 'idle' })

  // The Logs tab may sign in after this hook mounted, and the session lives in
  // storage rather than shared state; re-read on focus so the button appears
  // without a reload.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const refresh = (): void => setSession(loadLogServerSession())
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  const upload = useCallback(
    async (metadata: ArtifactUploadMetadata, content: string) => {
      const active = loadLogServerSession()
      if (!active) {
        setStatus({ kind: 'error', message: 'Sign in to your log server from the Logs tab first.' })
        setSession(undefined)
        return
      }
      setStatus({ kind: 'uploading' })
      try {
        const result = await uploadArtifact(active, metadata, content)
        setStatus({
          kind: 'done',
          message: `Uploaded ${metadata.fileName} to ${active.serverUrl} (${result.kind}).`
        })
      } catch (error) {
        setStatus({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Upload failed.'
        })
        // An expired token is the one failure the operator can fix right now,
        // so drop the dead session rather than leaving a sign-in that isn't one.
        if (error instanceof LogServerError && error.status === 401) {
          clearLogServerSession()
          setSession(undefined)
        }
      }
    },
    []
  )

  return {
    available: session !== undefined,
    serverUrl: session?.serverUrl,
    status,
    upload,
    reset: () => setStatus({ kind: 'idle' })
  }
}
