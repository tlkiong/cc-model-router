import type { Config, Tier } from './config'

// USD per million tokens: input, output, cache read. From the Claude pricing page on 2026-11-13; display only.
// Haiku 5.5 is the up-to-100K-prompt rate; prompts over 100K bill at five times it.
const PRICES: Record<string, [number, number, number]> = {
  'claude-haiku-5-5': [0.1, 0.5, 0.01],
  'claude-haiku-4-5': [1, 5, 0.1],
  'claude-sonnet-5-5': [2, 10, 0.1],
  'claude-sonnet-5': [2, 10, 0.2],
  'claude-sonnet-4-6': [3, 15, 0.3],
  'claude-opus-5-5': [4, 20, 0.2],
  'claude-opus-5': [5, 25, 0.5],
  'claude-opus-4-8': [5, 25, 0.5],
  'claude-opus-4-7': [5, 25, 0.5],
  'claude-opus-4-6': [5, 25, 0.5],
  'claude-fable-5-2': [8, 40, 0.2],
  'claude-fable-5-1': [10, 50, 0.25],
  'claude-fable-5': [10, 50, 1],
}

const ALIASES: Record<string, string> = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
  fable: 'claude-fable-5-2',
}

export function modelIdNormalize(model: string): string {
  const bare = model.replace(/\[1m\]$/, '')
  return ALIASES[bare] ?? bare
}

export function modelIdResolve(model: string): string {
  return `${modelIdNormalize(model)}${model.endsWith('[1m]') ? '[1m]' : ''}`
}

function usdText(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`
}

export function fallbackFind(config: Config, model: string): string | undefined {
  // Keys may be aliases or carry [1m], so both sides compare as bare ids
  const entry = Object.entries(config.fallbacks).find(([from]) => modelIdNormalize(from) === modelIdNormalize(model))
  return entry ? modelIdResolve(entry[1]) : undefined
}

export function priceText(model: string): string {
  const price = PRICES[modelIdNormalize(model)]
  return price ? `${usdText(price[0])}/${usdText(price[1])} per MTok` : ''
}

export function tierFind(config: Config, name: string | undefined): Tier | undefined {
  return config.tiers.find(function byName(tier) {
    return tier.name === name
  })
}

// A ceiling only lowers the classifier's pick; with no pick the ceiling tier runs, so a failed classify never leaves the spawn on the parent's model
export function tierCap(config: Config, agentType: string, tier: Tier | undefined): Tier | undefined {
  const cap = tierFind(config, config.subagents[agentType])
  if (!cap) return tier
  if (!tier) return cap
  return config.tiers.indexOf(tier) > config.tiers.indexOf(cap) ? cap : tier
}

export function tierModels(config: Config): string[] {
  return [...new Set(config.tiers.map((tier) => tier.model))]
}

export function tierTableLines(config: Config): string[] {
  const nameWidth = Math.max(...config.tiers.map((tier) => tier.name.length))
  const modelWidth = Math.max(...config.tiers.map((tier) => tier.model.length))
  return config.tiers.map(function line(tier) {
    return `${tier.name.padEnd(nameWidth)}  ${tier.model.padEnd(modelWidth)}  ${tier.effort.padEnd(6)}  ${priceText(tier.model)}`.trimEnd()
  })
}

// A request re-reads the cached context at the model's cache read price; a model change writes all of it to a new cache at 1.25 times the input price (5-minute TTL)
const CACHE_WRITE_RATE = 1.25

export function contextCost(model: string, tokens: number): { readUsd: number; writeUsd: number } | undefined {
  const price = PRICES[modelIdNormalize(model)]
  if (!price) return undefined
  const millions = tokens / 1_000_000
  return { readUsd: millions * price[2], writeUsd: millions * price[0] * CACHE_WRITE_RATE }
}

export function usdEstimateText(amount: number): string {
  return amount < 0.01 ? 'under $0.01' : `$${amount.toFixed(2)}`
}

export function tokensText(tokens: number): string {
  return tokens < 1000 ? `${tokens}` : `${Math.round(tokens / 1000)}k`
}
