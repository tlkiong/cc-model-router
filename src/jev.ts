import type { Config } from './config'

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
export const JEV_KEY_ENV = 'TYPESAFE_API_KEY'
export const JEV_MODEL_DEFAULT = 'jev-latest'
// Jev bills per input token and the tier is decided by the opening of a prompt, so a long paste is cut
const STATE_MAX_CHARS = 8000

export function jevRequestBuild(config: Config, text: string): string {
  const criteria: Record<string, string> = {}
  for (const tier of config.tiers) criteria[tier.name] = tier.criteria
  return JSON.stringify({
    state: text.slice(0, STATE_MAX_CHARS),
    model: config.classifier.model || JEV_MODEL_DEFAULT,
    questions: {
      tier: {
        type: 'choice',
        instructions: 'A coding assistant received this request. Pick the cheapest tier whose criteria cover the work it asks for.',
        criteria,
      },
    },
  })
}

export function jevHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
}

export function jevIsRetryable(status: number): boolean {
  return status === 429 || status === 529
}

export function jevResponseParse(text: string): string | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof raw !== 'object' || raw === null) return undefined
  const answers = (raw as { answers?: unknown }).answers
  if (typeof answers !== 'object' || answers === null) return undefined
  const answer = (answers as { tier?: unknown }).tier
  if (typeof answer !== 'object' || answer === null) return undefined
  const choice = (answer as { choice?: unknown }).choice
  return typeof choice === 'string' ? choice : undefined
}
