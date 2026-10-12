import type { Effort } from './config'

export const PLUGIN = 'cc-model-router'
export const LABEL = 'CC Model Router'
export const STORE_IS_DEFAULT = 'isDefault'
export const STORE_IS_ONBOARDED = 'isOnboarded'

export type Route = { tier: string; model: string; effort: Effort }
export type RouteKey = { turnId: string } | { agentId: string }

// Routes live for one turn, so losing them on a hot reload costs one turn on the session model and nothing more
const routes = new Map<string, Route>()

function routeKeyText(key: RouteKey): string {
  return 'agentId' in key ? `agent:${key.agentId}` : `turn:${key.turnId}`
}

export function routeSet(key: RouteKey, route: Route): void {
  routes.set(routeKeyText(key), route)
}

export function routeGet(key: RouteKey): Route | undefined {
  return routes.get(routeKeyText(key))
}

export function routeDrop(key: RouteKey): void {
  routes.delete(routeKeyText(key))
}

export function statusText(route: Route | null): string {
  return route === null ? `${LABEL}: on` : `${LABEL}: ${route.model} / ${route.effort}`
}

export function stateFilePath(home: string, sessionId: string): string {
  return `${home}/.claude/cc-model-router/sessions/${sessionId}.json`
}

export function stateFileText(isRouting: boolean, route: Route | null, now: number): string {
  return `${JSON.stringify({ isRouting, label: LABEL, tier: route?.tier ?? null, model: route?.model ?? null, effort: route?.effort ?? null, updatedAt: now })}\n`
}
