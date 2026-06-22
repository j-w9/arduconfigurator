// A failed WebSocket connect is the single most common point of confusion:
// people point it at a UDP address (e.g. the one that works in Mission Planner)
// and expect it to connect. A WebSocket is not a UDP connection, and a browser
// tab can't open a raw UDP/TCP/serial link at all. The raw transport error
// ("Failed to open WebSocket …") says nothing about that, so spell it out and
// steer them to the downloadable app, which can do UDP/TCP directly.
//
// Keyed off the connect-phase failure string emitted by WebSocketTransport, so
// mid-session drops (a different message) fall through unchanged.

const WEBSOCKET_OPEN_FAILURE_PREFIX = 'Failed to open WebSocket'

/**
 * Augments a WebSocket open failure with guidance that WebSocket is not a UDP
 * connection and that UDP/TCP needs the downloadable app; returns the message
 * unchanged otherwise.
 */
export function describeConnectionError(message: string): string {
  if (message.startsWith(WEBSOCKET_OPEN_FAILURE_PREFIX)) {
    return (
      `${message} A WebSocket is not a UDP connection — a browser tab can't open a ` +
      'raw UDP, TCP, or serial link. To connect over UDP or TCP (for example an ELRS ' +
      'or SITL link), use the downloadable app.'
    )
  }
  return message
}
