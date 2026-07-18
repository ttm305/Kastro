// ⚠️ TEMPORARY — DELETE THIS FILE after running `npm install` for the
// Capacitor packages listed in package.json.
//
// Why this file exists: the sandbox that produced this delivery has no
// npm registry access, so @capacitor/core, @capacitor/push-notifications,
// and @capacitor/app could not actually be installed — only declared in
// package.json (see the comment there). Without the real packages, their
// real .d.ts type definitions don't exist on disk, so `import { Capacitor
// } from '@capacitor/core'` (used in src/lib/nativePush.ts and src/App.tsx)
// would fail `tsc -b` with "Cannot find module" even though the *code*
// itself is correct and matches the real published API.
//
// This file is a minimal, hand-written stand-in — just enough of each
// module's real shape for the code that imports it to type-check — so
// `npm run build` passes in this sandbox right now, before the real
// packages exist.
//
// Once you run `npm install`, the REAL @capacitor/* packages will ship
// their own (much more complete) .d.ts files inside node_modules. At that
// point this file becomes redundant, and TypeScript may report duplicate
// module declarations if both exist — delete this file as the very first
// step after `npm install` and before your first local build.
declare module '@capacitor/core' {
  export const Capacitor: {
    isNativePlatform(): boolean
    getPlatform(): 'ios' | 'android' | 'web'
  }
}

declare module '@capacitor/push-notifications' {
  export interface PermissionStatus {
    receive: 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied'
  }
  export interface Token {
    value: string
  }
  export interface PushNotificationSchema {
    title?: string
    body?: string
    data: Record<string, string>
  }
  export interface ActionPerformed {
    actionId: string
    notification: PushNotificationSchema
  }
  export const PushNotifications: {
    checkPermissions(): Promise<PermissionStatus>
    requestPermissions(): Promise<PermissionStatus>
    register(): Promise<void>
    addListener(eventName: 'registration', cb: (token: Token) => void): Promise<{ remove: () => void }>
    addListener(eventName: 'registrationError', cb: (error: { error: string }) => void): Promise<{ remove: () => void }>
    addListener(eventName: 'pushNotificationReceived', cb: (notification: PushNotificationSchema) => void): Promise<{ remove: () => void }>
    addListener(eventName: 'pushNotificationActionPerformed', cb: (action: ActionPerformed) => void): Promise<{ remove: () => void }>
    removeAllListeners(): Promise<void>
    removeAllDeliveredNotifications(): Promise<void>
  }
}

declare module '@capacitor/app' {
  export interface AppState {
    isActive: boolean
  }
  export const App: {
    addListener(eventName: 'appStateChange', cb: (state: AppState) => void): Promise<{ remove: () => void }>
    addListener(eventName: 'backButton', cb: (data: { canGoBack: boolean }) => void): Promise<{ remove: () => void }>
    removeAllListeners(): Promise<void>
    exitApp(): Promise<void>
  }
}
