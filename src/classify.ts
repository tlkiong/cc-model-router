import type { ClassifierKind, Config } from './config'
import { JEV_MODEL_DEFAULT } from './jev'

export type ClassifierLive = Exclude<ClassifierKind, 'auto'>

// One question both classifiers read: Jev as a choice question under `key`, Claude as a prompt with the labels
export type Choice = { key: string; instructions: string; criteria: Record<string, string> }

export function classifierPick(kind: ClassifierKind, hasJevKey: boolean): ClassifierLive {
  if (kind === 'claude') return 'claude'
  return hasJevKey ? 'jev' : 'claude'
}

export function classifierLabel(live: ClassifierLive, config: Config): string {
  if (live === 'jev') return `Jev (${config.classifier.model || JEV_MODEL_DEFAULT})`
  return `Claude (${config.classifier.model || "engine's small model"})`
}

export function tierChoice(config: Config): Choice {
  return {
    key: 'tier',
    instructions: 'A coding assistant received this request. The tiers are listed cheapest first. Pick the cheapest tier whose criteria cover the work it asks for.',
    criteria: Object.fromEntries(config.tiers.map((tier) => [tier.name, tier.criteria])),
  }
}

export function claudePromptBuild(choice: Choice, text: string): string {
  const options = Object.entries(choice.criteria).map(([name, criteria]) => `- ${name}: ${criteria}`)
  return `${choice.instructions}\n\nOptions:\n${options.join('\n')}\n\n${text}`
}
