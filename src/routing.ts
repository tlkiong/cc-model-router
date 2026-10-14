import type { Effort, Tier } from './config'
import { modelIdResolve } from './tiers'

export const PLUGIN = 'cc-model-router'
export const LABEL = 'CC Model Router'

export type Route = { tier: string; model: string; effort: Effort }
export type RouteKey = { turnId: string } | { agentId: string }

// Routes live in memory only, so a hot reload costs the turns in flight their route and nothing more
const routes = new Map<string, Route>()

function routeKeyText(key: RouteKey): string {
  return 'agentId' in key ? `agent:${key.agentId}` : `turn:${key.turnId}`
}

export function routeBuild(tier: Tier): Route {
  // An alias is resolved here, so a step never relies on the engine resolving a rewritten model name
  return { tier: tier.name, model: modelIdResolve(tier.model), effort: tier.effort }
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

export function routesClear(): void {
  routes.clear()
}

export function stateFilePath(home: string, sessionId: string): string {
  return `${home}/.claude/cc-model-router/sessions/${sessionId}.json`
}

export function stateFileText(isRouting: boolean, route: Route | null, now: number): string {
  return `${JSON.stringify({ isRouting, label: LABEL, tier: route?.tier ?? null, model: route?.model ?? null, effort: route?.effort ?? null, updatedAt: now })}\n`
}
