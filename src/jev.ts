import type { Choice } from './classify'

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
export const JEV_KEY_ENV = 'TYPESAFE_API_KEY'
export const JEV_MODEL_DEFAULT = 'jev-latest'
// Jev bills per input token and the opening of the state decides the answer, so a long state is cut
const STATE_MAX_CHARS = 8000

export function jevRequestBuild(model: string, choice: Choice, text: string): string {
  return JSON.stringify({
    state: text.slice(0, STATE_MAX_CHARS),
    model: model || JEV_MODEL_DEFAULT,
    questions: { [choice.key]: { type: 'choice', instructions: choice.instructions, criteria: choice.criteria } },
  })
}

export function jevHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
}

export function jevIsRetryable(status: number): boolean {
  return status === 429 || status === 529
}

export function jevResponseParse(text: string, key: string): string | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof raw !== 'object' || raw === null) return undefined
  const answers = (raw as { answers?: Record<string, unknown> }).answers
  if (typeof answers !== 'object' || answers === null) return undefined
  const answer = answers[key]
  if (typeof answer !== 'object' || answer === null) return undefined
  const choice = (answer as { choice?: unknown }).choice
  return typeof choice === 'string' ? choice : undefined
}
