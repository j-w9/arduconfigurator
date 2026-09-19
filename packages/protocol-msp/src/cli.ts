// Betaflight CLI over the same serial port as MSP.
//
// `diff` is a CLI command, not an MSP one: there is no MSP message that returns
// a board's non-default settings. Betaflight Configurator gets it by dropping
// into the CLI, and so does this.
//
// Everything here is READ-ONLY. It sends `#` to enter, `diff` to read, and
// `exit noreboot` to leave. It never sends `set`, `save`, or anything that
// writes — a dump exists to record what was on the board, not to change it.

/** cliPrompt() in cli.c prints "\r\n# ". Seeing it is how we know we are in. */
export const CLI_PROMPT = '# '

export interface CliCaptureOptions {
  /** How long to wait for the prompt after '#'. */
  enterTimeoutMs?: number
  /** Overall cap on capturing the command's output. */
  captureTimeoutMs?: number
  /**
   * Output is finished when the board has been quiet this long AND a prompt has
   * been seen. `diff` streams in bursts, so a quiet gap is a better end signal
   * than a single prompt match — the word "# " appears inside diff's own
   * comment lines.
   */
  quietMs?: number
}

const DEFAULTS = { enterTimeoutMs: 3000, captureTimeoutMs: 15000, quietMs: 400 }

export interface CliTransport {
  send(frame: Uint8Array): Promise<void>
  onFrame(listener: (frame: Uint8Array) => void): () => void
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Enter the CLI, run one read-only command, and leave.
 *
 * Returns the command's raw text. Throws if the board never shows a prompt,
 * rather than sending the command blindly into whatever mode it is actually in.
 */
export async function captureCliCommand(
  transport: CliTransport,
  command: string,
  options: CliCaptureOptions = {}
): Promise<string> {
  const { enterTimeoutMs, captureTimeoutMs, quietMs } = { ...DEFAULTS, ...options }

  let buffer = ''
  let lastByteAt = Date.now()
  const unsubscribe = transport.onFrame((frame) => {
    buffer += decoder.decode(frame, { stream: true })
    lastByteAt = Date.now()
  })

  const waitFor = async (predicate: () => boolean, timeoutMs: number, what: string): Promise<void> => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      if (predicate()) return
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`)
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  try {
    // '#' enters the CLI. Confirm the prompt before sending anything else: if
    // the board is not in the CLI, the command would be interpreted by whatever
    // mode it IS in.
    buffer = ''
    await transport.send(encoder.encode('#'))
    await waitFor(() => buffer.includes(CLI_PROMPT), enterTimeoutMs, 'the Betaflight CLI prompt')

    buffer = ''
    lastByteAt = Date.now()
    await transport.send(encoder.encode(`${command}\r\n`))

    // Finished when it has gone quiet and said something. A prompt match alone
    // is unreliable: diff's own output contains lines beginning with '#'.
    await waitFor(
      () => buffer.length > 0 && Date.now() - lastByteAt > quietMs,
      captureTimeoutMs,
      `the output of "${command}"`
    )

    return buffer
  } finally {
    // Leave the CLI whatever happened — a board left sitting in the CLI stops
    // answering MSP.
    //
    // `noreboot` matters: cliExitCmd() in cli.c reads its argument as
    // `reboot = strcasecmp(cmdline, "noreboot") != 0`, so a bare `exit`
    // REBOOTS the board ("leaving CLI mode, unsaved changes lost"). Reading a
    // board's settings must not restart it — the operator would lose the MSP
    // link they are about to hand to DFU. Nothing was changed either way:
    // neither form saves.
    try {
      await transport.send(encoder.encode('exit noreboot\r\n'))
    } catch {
      /* the port may already be gone; the board leaves the CLI on reboot anyway */
    }
    unsubscribe()
  }
}

/**
 * Tidy a captured `diff` into what Betaflight Configurator would have saved.
 *
 * The board echoes the command back and finishes with a prompt; neither belongs
 * in a file meant to be pasted back into a CLI.
 *
 * Line endings are CRLF, which is what Betaflight Configurator writes and what
 * the board itself sends (cliPrint ends every line "\r\n"). Compared side by
 * side against a file saved by Betaflight Configurator from the same board,
 * LF was the whole difference in the settings — so it is the whole fix. It
 * matters beyond tidiness: these files get opened in Notepad on Windows, where
 * an LF-only file is one long line.
 */
export const CLI_LINE_ENDING = '\r\n'

export function cleanCliCapture(raw: string, command: string): string {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  while (lines.length > 0 && (lines[0].trim() === '' || lines[0].trim() === command)) {
    lines.shift()
  }
  while (lines.length > 0 && (lines[lines.length - 1].trim() === '' || lines[lines.length - 1].trim() === '#')) {
    lines.pop()
  }
  return `${lines.join(CLI_LINE_ENDING)}${CLI_LINE_ENDING}`
}
