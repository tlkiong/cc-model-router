export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

export const CLASSIFIER_KINDS = ['auto', 'jev', 'claude'] as const
export type ClassifierKind = (typeof CLASSIFIER_KINDS)[number]

export type Tier = { name: string; model: string; effort: Effort; criteria: string }
export type NewTask = { isAsking: boolean; minTokens: number }
export type Config = { tiers: Tier[]; subagents: Record<string, string>; newTask: NewTask; classifier: { kind: ClassifierKind; model: string } }

export const configDefault: Config = {
  tiers: [
    { name: 'trivial', model: 'claude-haiku-5-5', effort: 'low', criteria: 'one-line answers, typo or rename, reading a file, formatting, simple factual question' },
    { name: 'moderate', model: 'claude-sonnet-5-5', effort: 'high', criteria: 'single-file edit, small feature, straightforward bug, tests for existing code' },
    { name: 'complex', model: 'claude-opus-5-5', effort: 'medium', criteria: 'multi-file change, debugging across modules, refactor, design decision with known constraints' },
    { name: 'hardest', model: 'claude-opus-5-5', effort: 'xhigh', criteria: 'architecture, ambiguous spec, security-sensitive work, long autonomous multi-step task' },
    { name: 'escalate', model: 'claude-fable-5-1', effort: 'high', criteria: 'retry of a fix that already failed, still broken after repeated attempts, flagship-quality writing' },
  ],
  subagents: { 'general-purpose': 'moderate' },
  newTask: { isAsking: true, minTokens: 20000 },
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
  const names = new Set<string>()
  if (!Array.isArray(raw.tiers) || raw.tiers.length === 0) {
    errors.push('tiers must be a non-empty array')
  } else {
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

  // A config written before this key existed keeps the default ceilings; one naming a tier the file lacks is skipped when applied
  let subagents = configDefault.subagents
  if (raw.subagents !== undefined) {
    if (!isRecord(raw.subagents)) {
      errors.push('subagents must be an object of agent type to tier name')
    } else {
      subagents = {}
      for (const [agentType, tierName] of Object.entries(raw.subagents)) {
        if (typeof tierName === 'string' && names.has(tierName)) subagents[agentType] = tierName
        else errors.push(`subagents["${agentType}"] must name one of the tiers`)
      }
    }
  }

  let newTask = configDefault.newTask
  if (raw.newTask !== undefined) {
    if (!isRecord(raw.newTask)) {
      errors.push('newTask must be an object')
    } else {
      const isAsking = raw.newTask.isAsking ?? configDefault.newTask.isAsking
      const minTokens = raw.newTask.minTokens ?? configDefault.newTask.minTokens
      if (typeof isAsking !== 'boolean') errors.push('newTask.isAsking must be true or false')
      const isMinTokensValid = typeof minTokens === 'number' && Number.isFinite(minTokens) && minTokens >= 0
      if (!isMinTokensValid) errors.push('newTask.minTokens must be a number, 0 or more')
      if (typeof isAsking === 'boolean' && isMinTokensValid) newTask = { isAsking, minTokens }
    }
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
  return { config: { tiers, subagents, newTask, classifier }, errors: [] }
}
