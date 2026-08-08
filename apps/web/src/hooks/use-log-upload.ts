import { useCallback, useEffect, useState } from 'react'
import type { ConfiguratorSnapshot, LogDownloadProgress } from '@arduconfig/ardupilot-core'

import {
  login as loginToServer,
  LogServerError,
  uploadLog,
  type LogServerSession,
  type LogUploadMetadata
} from '../log-upload/client'
import {
  clearLogServerSession,
  loadLogServerSession,
  loadLogServerSettings,
  saveLogServerSession
} from '../log-upload/session-storage'
import { buildLogUploadFormModel, type LogUploadFormModel } from '../view-models/log-upload-form'

/** The slice of the runtime needed to pull a log's bytes without saving a file. */
export interface LogUploadCapableRuntime {
  downloadOnboardLog(
    id: number,
    sizeBytes: number,
    onProgress?: (progress: LogDownloadProgress) => void
  ): Promise<Uint8Array>
  downloadMavftpLog(path: string, onProgress?: (progress: LogDownloadProgress) => void): Promise<Uint8Array>
  getSnapshot(): ConfiguratorSnapshot
}

export interface LogUploadTarget {
  id: number
  nameLabel?: string
  dateLabel: string
  sizeBytes: number
  /** Present when the log came from the MAVFTP listing. */
  mavftpPath?: string
}

export type LogUploadPhase = 'idle' | 'reading' | 'sending' | 'done' | 'error'

export interface UseLogUploadResult {
  session: LogServerSession | undefined
  /** Remembered address/username, so the sign-in form is prefilled. */
  rememberedServerUrl: string
  rememberedUsername: string
  signingIn: boolean
  signInError?: string
  signIn: (serverUrl: string, username: string, password: string) => Promise<void>
  signOut: () => void

  /** The log the dialog is open for, with its prefilled + autofilled fields. */
  pending?: { target: LogUploadTarget; form: LogUploadFormModel }
  openUpload: (target: LogUploadTarget) => void
  cancelUpload: () => void

  phase: LogUploadPhase
  progressRatio?: number
  message?: string
  submit: (answers: { flightDate: string; note: string }) => Promise<void>
}

/**
 * Upload an onboard log to the operator's own ArduLogs server.
 *
 * The bytes are pulled off the flight controller and handed straight to the
 * upload — never written to disk on the way. Downloading and then re-picking the
 * file would work, but on a phone or tablet at a field site "save then find it
 * again" is exactly the step that does not happen.
 */
export function useLogUpload(runtime: LogUploadCapableRuntime | undefined): UseLogUploadResult {
  const [session, setSession] = useState<LogServerSession | undefined>(undefined)
  const [remembered, setRemembered] = useState<{ serverUrl: string; username: string }>({
    serverUrl: '',
    username: ''
  })
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState<string | undefined>(undefined)
  const [pending, setPending] = useState<{ target: LogUploadTarget; form: LogUploadFormModel } | undefined>(undefined)
  const [phase, setPhase] = useState<LogUploadPhase>('idle')
  const [progressRatio, setProgressRatio] = useState<number | undefined>(undefined)
  const [message, setMessage] = useState<string | undefined>(undefined)

  // Restore on mount: a refresh mid-session should not force a re-login, and
  // the address/username should already be filled in even when it does.
  useEffect(() => {
    setSession(loadLogServerSession())
    const settings = loadLogServerSettings()
    if (settings) {
      setRemembered({ serverUrl: settings.serverUrl, username: settings.username })
    }
  }, [])

  const signIn = useCallback(async (serverUrl: string, username: string, password: string) => {
    setSigningIn(true)
    setSignInError(undefined)
    try {
      const next = await loginToServer(serverUrl, username, password)
      saveLogServerSession(next)
      setSession(next)
      setRemembered({ serverUrl: next.serverUrl, username: next.username })
    } catch (error) {
      setSignInError(error instanceof Error ? error.message : 'Sign-in failed.')
    } finally {
      // The password is never stored anywhere; it lives only in the caller's
      // form state, which is cleared when the form unmounts.
      setSigningIn(false)
    }
  }, [])

  const signOut = useCallback(() => {
    clearLogServerSession()
    setSession(undefined)
    setPending(undefined)
    setPhase('idle')
    setMessage(undefined)
  }, [])

  const openUpload = useCallback(
    (target: LogUploadTarget) => {
      if (!runtime) {
        return
      }
      setPending({
        target,
        form: buildLogUploadFormModel({
          snapshot: runtime.getSnapshot(),
          log: { id: target.id, nameLabel: target.nameLabel, dateLabel: target.dateLabel }
        })
      })
      setPhase('idle')
      setProgressRatio(undefined)
      setMessage(undefined)
    },
    [runtime]
  )

  const cancelUpload = useCallback(() => {
    setPending(undefined)
    setPhase('idle')
    setProgressRatio(undefined)
  }, [])

  const submit = useCallback(
    async (answers: { flightDate: string; note: string }) => {
      if (!runtime || !session || !pending) {
        return
      }
      const { target, form } = pending
      setPhase('reading')
      setProgressRatio(0)
      setMessage(undefined)
      try {
        // Coalesce to whole percent: a burst read fires a progress callback per
        // packet, and re-rendering on each one makes the bar stutter.
        let lastPercent = -1
        const onProgress = (progress: LogDownloadProgress) => {
          const ratio = progress.totalBytes > 0 ? progress.bytesReceived / progress.totalBytes : 0
          const percent = Math.round(ratio * 100)
          if (percent !== lastPercent) {
            lastPercent = percent
            setProgressRatio(ratio)
          }
        }

        const bytes = target.mavftpPath
          ? await runtime.downloadMavftpLog(target.mavftpPath, onProgress)
          : await runtime.downloadOnboardLog(target.id, target.sizeBytes, onProgress)

        setPhase('sending')
        setProgressRatio(undefined)
        const metadata: LogUploadMetadata = {
          ...form.metadata,
          flightDate: answers.flightDate.trim() || undefined,
          note: answers.note.trim() || undefined
        }
        const result = await uploadLog(session, metadata, bytes)
        setPhase('done')
        setMessage(`Uploaded ${metadata.fileName} (${(result.sizeBytes / (1024 * 1024)).toFixed(1)} MB) to ${session.serverUrl}.`)
        setPending(undefined)
      } catch (error) {
        setPhase('error')
        setMessage(error instanceof Error ? error.message : 'Upload failed.')
        // An expired token is the one failure the operator can fix immediately,
        // so drop the dead session rather than leaving a sign-in that isn't one.
        if (error instanceof LogServerError && error.status === 401) {
          clearLogServerSession()
          setSession(undefined)
        }
      }
    },
    [pending, runtime, session]
  )

  return {
    session,
    rememberedServerUrl: remembered.serverUrl,
    rememberedUsername: remembered.username,
    signingIn,
    signInError,
    signIn,
    signOut,
    pending,
    openUpload,
    cancelUpload,
    phase,
    progressRatio,
    message,
    submit
  }
}
