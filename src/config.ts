export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

export const CLASSIFIER_KINDS = ['auto', 'jev', 'claude'] as const
export type ClassifierKind = (typeof CLASSIFIER_KINDS)[number]

export type Tier = { name: string; model: string; effort: Effort; criteria: string }
export type Config = { tiers: Tier[]; classifier: { kind: ClassifierKind; model: string } }

export const configDefault: Config = {
  tiers: [
    { name: 'trivial', model: 'claude-haiku-5-5', effort: 'low', criteria: 'one-line answers, typo or rename, reading a file, formatting, simple factual question' },
    { name: 'moderate', model: 'claude-sonnet-5-5', effort: 'medium', criteria: 'single-file edit, small feature, straightforward bug, tests for existing code' },
    { name: 'complex', model: 'claude-opus-5-5', effort: 'high', criteria: 'multi-file change, debugging across modules, refactor, design decision with known constraints' },
    { name: 'hardest', model: 'claude-fable-5-1', effort: 'xhigh', criteria: 'architecture, ambiguous spec, security-sensitive work, long autonomous multi-step task' },
  ],
  classifier: { kind: 'auto', model: '' },
}

export function configPath(home: string): string {
  return `${home}/.claude/cc-model-router/config.json`
}

export function configText(config: Config): string {
  return `${JSON.stringify(config, null, 2)}\n`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isEffort(value: unknown): value is Effort {
  return typeof value === 'string' && (EFFORTS as readonly string[]).includes(value)
}

function isClassifierKind(value: unknown): value is ClassifierKind {
  return typeof value === 'string' && (CLASSIFIER_KINDS as readonly string[]).includes(value)
}

export function configParse(text: string): { config: Config | null; errors: string[] } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { config: null, errors: [`not valid JSON: ${error instanceof Error ? error.message : String(error)}`] }
  }
  if (!isRecord(raw)) return { config: null, errors: ['top level must be an object'] }

  const errors: string[] = []
  const tiers: Tier[] = []
  if (!Array.isArray(raw.tiers) || raw.tiers.length === 0) {
    errors.push('tiers must be a non-empty array')
  } else {
    const names = new Set<string>()
    raw.tiers.forEach((entry, index) => {
      const at = `tiers[${index}]`
      if (!isRecord(entry)) {
        errors.push(`${at} must be an object`)
        return
      }
      if (!isNonEmptyString(entry.name)) errors.push(`${at}.name must be a non-empty string`)
      else if (names.has(entry.name)) errors.push(`${at}.name "${entry.name}" is used twice`)
      else names.add(entry.name)
      if (!isNonEmptyString(entry.model)) errors.push(`${at}.model must be a non-empty string`)
      if (!isEffort(entry.effort)) errors.push(`${at}.effort must be one of ${EFFORTS.join(', ')}`)
      if (!isNonEmptyString(entry.criteria)) errors.push(`${at}.criteria must be a non-empty string`)
      if (isNonEmptyString(entry.name) && isNonEmptyString(entry.model) && isEffort(entry.effort) && isNonEmptyString(entry.criteria)) {
        tiers.push({ name: entry.name, model: entry.model, effort: entry.effort, criteria: entry.criteria })
      }
    })
  }

  let classifier: Config['classifier'] = { kind: 'auto', model: '' }
  if (raw.classifier !== undefined) {
    if (!isRecord(raw.classifier)) {
      errors.push('classifier must be an object')
    } else {
      const kind = raw.classifier.kind ?? 'auto'
      const model = raw.classifier.model ?? ''
      if (!isClassifierKind(kind)) errors.push(`classifier.kind must be one of ${CLASSIFIER_KINDS.join(', ')}`)
      if (typeof model !== 'string') errors.push('classifier.model must be a string')
      if (isClassifierKind(kind) && typeof model === 'string') classifier = { kind, model }
    }
  }

  if (errors.length > 0) return { config: null, errors }
  return { config: { tiers, classifier }, errors: [] }
}
