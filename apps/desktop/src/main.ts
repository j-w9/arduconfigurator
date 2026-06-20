import { NativeSerialTransport } from './native-serial-transport.js'
import { desktopPlatformManifest } from './platform.js'

console.log('[desktop-adapter]')
console.log(desktopPlatformManifest.intent)
console.log(`Target transports: ${desktopPlatformManifest.targetTransports.join(', ')}`)
console.log(`Native serial transport available: ${NativeSerialTransport.name}`)
