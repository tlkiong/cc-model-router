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

// The same tier picked on the very next turn means its first pass did not settle the work, so it reruns at the stepped-up effort
export function routeStepUp(route: Route, previous: Route | null, stepUp: Record<string, Effort>): Route {
  const effort = stepUp[route.tier]
  return effort && previous?.tier === route.tier ? { ...route, effort } : route
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

// A model that failed once, say at its usage limit, stays skipped until the session ends, so later steps go straight to its fallback
const failedModels = new Set<string>()

export function modelFailedMark(model: string): void {
  failedModels.add(model)
}

export function isModelFailed(model: string): boolean {
  return failedModels.has(model)
}

export function routesClear(): void {
  routes.clear()
  failedModels.clear()
}

export function stateFilePath(home: string, sessionId: string): string {
  return `${home}/.claude/cc-model-router/sessions/${sessionId}.json`
}

export function stateFileText(isRouting: boolean, route: Route | null, now: number): string {
  return `${JSON.stringify({ isRouting, label: LABEL, tier: route?.tier ?? null, model: route?.model ?? null, effort: route?.effort ?? null, updatedAt: now })}\n`
}
