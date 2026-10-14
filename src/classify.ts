import type { ClassifierKind, Config } from './config'
import { JEV_MODEL_DEFAULT } from './jev'
import { criteriaText } from './tiers'

export type ClassifierLive = Exclude<ClassifierKind, 'auto'>

export function classifierPick(kind: ClassifierKind, hasJevKey: boolean): ClassifierLive {
  if (kind === 'claude') return 'claude'
  return hasJevKey ? 'jev' : 'claude'
}

export function classifierLabel(live: ClassifierLive, config: Config): string {
  if (live === 'jev') return `Jev (${config.classifier.model || JEV_MODEL_DEFAULT})`
  return `Claude (${config.classifier.model || "engine's small model"})`
}

export function claudePromptBuild(config: Config, text: string): string {
  return `Tiers, cheapest first, with the work each covers:\n${criteriaText(config)}\n\nPick the cheapest tier whose criteria cover this request to a coding assistant:\n\n${text}`
}
