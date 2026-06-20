export const desktopPlatformManifest = {
  appId: '@arduconfig/desktop',
  intent: 'Thin desktop adapter around the shared web frontend and protocol core.',
  targetTransports: ['native-serial', 'websocket'],
  browserParityGoal: 'All domain logic remains in shared packages so browser-only deployment stays viable.'
} as const
