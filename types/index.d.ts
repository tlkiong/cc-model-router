export type CcModelRouterEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type CcModelRouterRoute = { tier: string; model: string; effort: CcModelRouterEffort }

declare module 'claude-code' {
  interface PluginState {
    'cc-model-router': {
      isRouting: boolean
      lastRoute: CcModelRouterRoute | null
    }
  }
}
