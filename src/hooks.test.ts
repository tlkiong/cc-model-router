import type { AgentSpawnInput, CommandRunInput, On, PromptSubmitInput, SessionContextBreakdown, SessionStartInput, TurnCompleteInput, TurnStepInput } from 'claude-code'
import { type Engine, expect, mock, test } from 'claude-code/testing'
import { CLEAR_NO, CLEAR_YES, TASK_NEW, TASK_SAME } from './clear'
import { configDefault, configText } from './config'

type Seen = {
  stepModels: string[]
  stepEfforts: (string | number | undefined)[]
  spawnModels: (string | undefined)[]
  commands: string[]
  writes: Record<string, string>
  opens: number
  asks: string[]
  submits: PromptSubmitInput[]
  fills: string[]
  taskClassifies: number
}

type StubOptions = {
  classifyAnswer?: string
  taskAnswer?: string
  askAnswer?: string
  messagesTokens?: number
  hasConfigFile?: boolean
  configFile?: string
  env?: Record<string, string>
  store?: Record<string, unknown>
}

const SESSION_MODEL = 'claude-fable-5-1[1m]'
const ENGINE = { plugin: 'engine', tier: 'core' } as const

// every $ call the plugin makes needs an answer, so one stub plays the engine for every scenario
function engineStub(on: On, options: StubOptions = {}): Seen {
  const seen: Seen = { stepModels: [], stepEfforts: [], spawnModels: [], commands: [], writes: {}, opens: 0, asks: [], submits: [], fills: [], taskClassifies: 0 }
  // a real sleep stalls the 429 retry test on the mocked clock, so sleep answers at once
  on('clock.sleep', () => ({ value: undefined }))
  mock.env(on, { HOME: '/home/me', ...(options.env ?? {}) })
  mock.store(on, options.store ?? { isOnboarded: true })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.model', () => ({ value: SESSION_MODEL }))
  on('fs.exists', () => ({ value: options.hasConfigFile ?? true }))
  on('fs.read', () => ({ value: options.configFile ?? configText(configDefault) }))
  on('fs.write', ($, e) => {
    seen.writes[e.path] = e.text
    return { value: undefined }
  })
  on('model.classify', ($, e) => {
    if (!e.labels.includes(TASK_NEW)) return { value: options.classifyAnswer ?? 'trivial' }
    seen.taskClassifies += 1
    return { value: options.taskAnswer ?? TASK_SAME }
  })
  on('session.usage', () => {
    const breakdown = { categories: [{ name: 'Messages', tokens: options.messagesTokens ?? 0, color: '', isDeferred: false, kind: 'used' }] } as unknown as SessionContextBreakdown
    return { value: { startedAt: 0, context: { window: 200000, breakdown }, rateLimits: [] } }
  })
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'fix the login bug', toolUses: [] },
      { role: 'assistant', text: 'fixed in auth.ts', toolUses: [] },
    ],
  }))
  // $.ui.ask is raised as an AskUserQuestion tool call, answered by question text
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
    const question = e.questions[0]?.question ?? ''
    seen.asks.push(question)
    return { result: { questions: e.questions, answers: { [question]: options.askAnswer ?? CLEAR_NO } } }
  })
  on('prompt.submit', ($, e) => {
    seen.submits.push(e)
    return { text: e.text }
  })
  on('prompt.fill', ($, e) => {
    seen.fills.push(e.text)
    return { isFilled: true }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => {
    seen.opens += 1
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* ($, e) {
    seen.stepModels.push(e.model)
    seen.stepEfforts.push(e.effort)
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage: null }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', ($, e) => {
    seen.spawnModels.push(e.model)
    return { model: e.model ?? e.parentModel, agentId: 'agent-1' }
  })
  on('command.run', ($, e) => {
    seen.commands.push(`${e.command} ${e.args}`.trim())
    return { text: '' }
  })
  on('classic.PostModelSwitch', () => ({}))
  return seen
}

function sessionStart(surface: SessionStartInput['surface'] = null): SessionStartInput {
  return { cwd: '/tmp', surface, isInteractive: surface !== null }
}

function stepInput(turnId: string, agentId?: string): TurnStepInput {
  return { turnId, index: 0, model: SESSION_MODEL, effort: 'xhigh', messageCount: 1, ...(agentId ? { agentId } : {}) }
}

// the step stream settles only once read to its end, so the test drains it before reading the result
async function stepRun($: Pick<Engine, 'turn'>, input: TurnStepInput): Promise<void> {
  const stream = $.turn.step(input)
  for await (const _chunk of stream) {
    // chunks are read only to settle the stream
  }
  await stream.result
}

function completeInput(turnId: string): TurnCompleteInput {
  return { turnId, reason: 'answer', answer: '', durationMs: 1, isAborted: false }
}

function spawnInput(extra: Partial<AgentSpawnInput> = {}): AgentSpawnInput {
  return { tool_use_id: 'tu-1', prompt: 'list the files', description: 'list', subagentType: 'Explore', provider: ENGINE, parentModel: SESSION_MODEL, background: false, fork: false, ...extra }
}

function commandInput(command: string, args = ''): CommandRunInput {
  return { command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } }
}

test('routing off: a turn keeps the session model', async ($, on) => {
  const seen = engineStub(on, { store: {} })
  await $.session.start(sessionStart())
  await $.turn.start({ text: 'fix the typo', turnId: 't1' })
  await stepRun($, stepInput('t1'))
  expect(seen.stepModels).toEqual([SESSION_MODEL])
  expect(seen.stepEfforts).toEqual(['xhigh'])
})

test('routing on: a trivial turn runs on haiku at low effort, then the route is dropped', async ($, on) => {
  const seen = engineStub(on, { classifyAnswer: 'trivial', store: { isDefault: true, isOnboarded: true } })
  await $.session.start(sessionStart('terminal'))
  await $.turn.start({ text: 'fix the typo', turnId: 't1' })
  await stepRun($, stepInput('t1'))
  await $.turn.complete(completeInput('t1'))
  await stepRun($, stepInput('t1'))
  expect(seen.stepModels).toEqual(['claude-haiku-5-5', SESSION_MODEL])
  expect(seen.stepEfforts).toEqual(['low', 'xhigh'])
  expect(seen.writes['/home/me/.claude/cc-model-router/sessions/sess-1.json']).toMatch(/"isRouting":true/)
})

test('routing on: the hardest tier reaches opus at xhigh', async ($, on) => {
  const seen = engineStub(on, { classifyAnswer: 'hardest', store: { isDefault: true, isOnboarded: true } })
  await $.session.start(sessionStart())
  await $.turn.start({ text: 'redesign the auth architecture', turnId: 't2' })
  await stepRun($, stepInput('t2'))
  expect(seen.stepModels).toEqual(['claude-opus-5-5'])
  expect(seen.stepEfforts).toEqual(['xhigh'])
})

test('routing on: the escalate tier reaches fable at high', async ($, on) => {
  const seen = engineStub(on, { classifyAnswer: 'escalate', store: { isDefault: true, isOnboarded: true } })
  await $.session.start(sessionStart())
  await $.turn.start({ text: 'that fix did not work, still broken', turnId: 't2b' })
  await stepRun($, stepInput('t2b'))
  expect(seen.stepModels).toEqual(['claude-fable-5-1'])
  expect(seen.stepEfforts).toEqual(['high'])
})

test('routing on: an unknown tier name leaves the turn alone', async ($, on) => {
  const seen = engineStub(on, { classifyAnswer: 'nope', store: { isDefault: true, isOnboarded: true } })
  await $.session.start(sessionStart())
  await $.turn.start({ text: 'anything', turnId: 't3' })
  await stepRun($, stepInput('t3'))
  expect(seen.stepModels).toEqual([SESSION_MODEL])
})

test('subagent: an undecided spawn gets the tier model and its steps get the effort', async ($, on) => {
  const seen = engineStub(on, { classifyAnswer: 'moderate', store: { isDefault: true, isOnboarded: true } })
  await $.session.start(sessionStart())
  const spawned = await $.agent.spawn(spawnInput())
  expect(seen.spawnModels).toEqual(['claude-sonnet-5-5'])
  expect(spawned.agentId).toBe('agent-1')
  await stepRun($, stepInput('t9', 'agent-1'))
  expect(seen.stepModels).toEqual(['claude-sonnet-5-5'])
  expect(seen.stepEfforts).toEqual(['high'])
})

test('subagent: an explicit model or a fork is never rerouted', async ($, on) => {
  const seen = engineStub(on, { classifyAnswer: 'trivial', store: { isDefault: true, isOnboarded: true } })
  await $.session.start(sessionStart())
  await $.agent.spawn(spawnInput({ model: 'opus' }))
  await $.agent.spawn(spawnInput({ subagentType: 'fork', fork: true }))
  expect(seen.spawnModels).toEqual(['opus', undefined])
})

test('/model with a name passes through and turns routing off', async ($, on) => {
  const seen = engineStub(on, { classifyAnswer: 'trivial', store: { isDefault: true, isOnboarded: true } })
  await $.session.start(sessionStart())
  await $.command.run(commandInput('model', 'opus'))
  expect(seen.commands).toContain('model opus')
  await $.turn.start({ text: 'fix the typo', turnId: 't4' })
  await stepRun($, stepInput('t4'))
  expect(seen.stepModels).toEqual([SESSION_MODEL])
})

test('/model with no args opens the picker instead of the built-in', async ($, on) => {
  const seen = engineStub(on)
  await $.session.start(sessionStart())
  const result = await $.command.run(commandInput('model'))
  expect(result.text).toMatch(/pick a model/)
  expect(seen.commands).toEqual([])
  expect(seen.opens).toBe(1)
})

test('/cc-model-router on, off and status', async ($, on) => {
  engineStub(on)
  await $.session.start(sessionStart())
  const turnedOn = await $.command.run(commandInput('cc-model-router', 'on'))
  expect(turnedOn.text).toMatch(/on, and the default/)
  const turnedOff = await $.command.run(commandInput('cc-model-router', 'off'))
  expect(turnedOff.text).toMatch(/off/)
  const status = await $.command.run(commandInput('cc-model-router', 'status'))
  expect(status.text).toMatch(/CC Model Router: off/)
  expect(status.text).toMatch(/trivial\s+claude-haiku-5-5/)
  const config = await $.command.run(commandInput('cc-model-router', 'config'))
  expect(config.text).toMatch(/config: \/home\/me\/.claude\/cc-model-router\/config.json/)
})

test('a manual model switch elsewhere turns routing off', async ($, on) => {
  const seen = engineStub(on, { classifyAnswer: 'trivial', store: { isDefault: true, isOnboarded: true } })
  await $.session.start(sessionStart())
  await $.classic.PostModelSwitch({
    from_model: 'a',
    to_model: 'claude-opus-5-5',
    requested_model: 'opus',
    source: 'picker',
    context_tokens: 0,
    prompt_cache_warm: false,
    cache_ttl: '5m',
    estimated_cache_write_usd: 0,
    pricing: 'default',
  })
  await $.turn.start({ text: 'fix the typo', turnId: 't5' })
  await stepRun($, stepInput('t5'))
  expect(seen.stepModels).toEqual([SESSION_MODEL])
})

test('an automatic switch (fallback, resume) leaves routing on', async ($, on) => {
  const seen = engineStub(on, { classifyAnswer: 'trivial', store: { isDefault: true, isOnboarded: true } })
  await $.session.start(sessionStart())
  await $.classic.PostModelSwitch({
    from_model: 'a',
    to_model: 'b',
    requested_model: null,
    source: 'auto',
    context_tokens: 0,
    prompt_cache_warm: false,
    cache_ttl: '5m',
    estimated_cache_write_usd: 0,
    pricing: 'default',
  })
  await $.turn.start({ text: 'fix the typo', turnId: 't6' })
  await stepRun($, stepInput('t6'))
  expect(seen.stepModels).toEqual(['claude-haiku-5-5'])
})

test('first start writes the default config and opens onboarding once', async ($, on) => {
  const seen = engineStub(on, { hasConfigFile: false, store: {} })
  await $.session.start(sessionStart('terminal'))
  expect(seen.writes['/home/me/.claude/cc-model-router/config.json']).toBe(configText(configDefault))
  expect(seen.opens).toBe(1)
  await $.session.start(sessionStart('terminal'))
  expect(seen.opens).toBe(1)
})

test('headless start never opens onboarding', async ($, on) => {
  const seen = engineStub(on, { store: {} })
  await $.session.start(sessionStart(null))
  expect(seen.opens).toBe(0)
})

test('jev: with a key the classifier posts to typesafe and maps the choice', async ($, on) => {
  const seen = engineStub(on, { classifyAnswer: 'trivial', env: { TYPESAFE_API_KEY: 'k' }, store: { isDefault: true, isOnboarded: true } })
  const bodies: string[] = []
  on('http.fetch', ($, e) => {
    bodies.push(e.init?.body ?? '')
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers: { tier: { type: 'choice', choice: 'complex', confidence: 1 } } }) } }
  })
  await $.session.start(sessionStart())
  await $.turn.start({ text: 'refactor the module graph', turnId: 't7' })
  await stepRun($, stepInput('t7'))
  expect(bodies).toHaveLength(1)
  expect(JSON.parse(bodies[0] ?? '{}').questions.tier.criteria.complex).toBe(configDefault.tiers[2]?.criteria)
  expect(seen.stepModels).toEqual(['claude-opus-5-5'])
  expect(seen.stepEfforts).toEqual(['medium'])
})

test('jev: a 429 is retried once, a 401 falls back to claude', async ($, on) => {
  const seen = engineStub(on, { classifyAnswer: 'trivial', env: { TYPESAFE_API_KEY: 'k' }, store: { isDefault: true, isOnboarded: true } })
  const statuses = [429, 200, 401]
  on('http.fetch', () => {
    const status = statuses.shift() ?? 500
    return { value: { status, ok: status === 200, headers: {}, text: JSON.stringify({ answers: { tier: { type: 'choice', choice: 'hardest' } } }) } }
  })
  await $.session.start(sessionStart())
  await $.turn.start({ text: 'a', turnId: 't8' })
  await stepRun($, stepInput('t8'))
  await $.turn.start({ text: 'b', turnId: 't9' })
  await stepRun($, stepInput('t9'))
  expect(seen.stepModels).toEqual(['claude-opus-5-5', 'claude-haiku-5-5'])
  expect(statuses).toEqual([])
})

test('subagent: a workflow agent is never rerouted', async ($, on) => {
  const seen = engineStub(on, { classifyAnswer: 'trivial', store: { isDefault: true, isOnboarded: true } })
  await $.session.start(sessionStart())
  await $.agent.spawn(spawnInput({ workflow: { runId: 'wf_1', agentIndex: 1 } }))
  expect(seen.spawnModels).toEqual([undefined])
})

test('subagent: the route outlives one run, so a woken subagent keeps its tier', async ($, on) => {
  const seen = engineStub(on, { classifyAnswer: 'moderate', store: { isDefault: true, isOnboarded: true } })
  await $.session.start(sessionStart())
  await $.agent.spawn(spawnInput())
  await $.turn.complete({ ...completeInput('t10'), agentId: 'agent-1' })
  await stepRun($, stepInput('t11', 'agent-1'))
  expect(seen.stepModels).toEqual(['claude-sonnet-5-5'])
})

test('/cc-model-router with an unknown verb names the valid ones', async ($, on) => {
  engineStub(on)
  await $.session.start(sessionStart())
  const result = await $.command.run(commandInput('cc-model-router', 'stauts'))
  expect(result.text).toMatch(/unknown "stauts"\. Use on \| off \| status \| config \| update-config \[--force\] \| onboard\./)
})

test('/cc-model-router update-config adds missing keys and keeps the user values', async ($, on) => {
  const oldText = `${JSON.stringify({ tiers: configDefault.tiers, classifier: { kind: 'auto', model: 'haiku' } }, null, 2)}\n`
  const seen = engineStub(on, { configFile: oldText })
  await $.session.start(sessionStart())
  const result = await $.command.run(commandInput('cc-model-router', 'update-config'))
  expect(result.text).toMatch(/config updated, added subagents, newTask with defaults/)
  expect(seen.writes['/home/me/.claude/cc-model-router/config.json.bak']).toBe(oldText)
  const written = JSON.parse(seen.writes['/home/me/.claude/cc-model-router/config.json'] ?? '{}')
  expect(written.classifier).toEqual({ kind: 'auto', model: 'haiku' })
  expect(written.subagents).toEqual(configDefault.subagents)
  expect(written.newTask).toEqual(configDefault.newTask)
})

test('/cc-model-router update-config refuses a merge that would not parse', async ($, on) => {
  // The default ceiling names moderate, which this tier list lacks
  const oldText = '{ "tiers": [{ "name": "mine", "model": "opus", "effort": "max", "criteria": "x" }] }\n'
  const seen = engineStub(on, { configFile: oldText })
  await $.session.start(sessionStart())
  const result = await $.command.run(commandInput('cc-model-router', 'update-config'))
  expect(result.text).toMatch(/config not updated, the merged file has errors/)
  expect(result.text).toMatch(/subagents\["general-purpose"\] must name one of the tiers/)
  expect(result.text).toMatch(/update-config --force/)
  expect(Object.keys(seen.writes).filter((path) => path.includes('config.json'))).toEqual([])
})

test('/cc-model-router update-config --force replaces the file and keeps the old one', async ($, on) => {
  const oldText = '{ "tiers": [{ "name": "mine", "model": "opus", "effort": "max", "criteria": "x" }] }\n'
  const seen = engineStub(on, { configFile: oldText })
  await $.session.start(sessionStart())
  const result = await $.command.run(commandInput('cc-model-router', 'update-config --force'))
  expect(result.text).toMatch(/config replaced with the defaults/)
  expect(seen.writes['/home/me/.claude/cc-model-router/config.json.bak']).toBe(oldText)
  expect(seen.writes['/home/me/.claude/cc-model-router/config.json']).toBe(configText(configDefault))
})

test('/cc-model-router update-config leaves a file that has every key alone', async ($, on) => {
  const seen = engineStub(on)
  await $.session.start(sessionStart())
  const result = await $.command.run(commandInput('cc-model-router', 'update-config'))
  expect(result.text).toMatch(/already has every key/)
  const forced = await $.command.run(commandInput('cc-model-router', 'update-config --force'))
  expect(forced.text).toMatch(/already matches the defaults/)
  expect(Object.keys(seen.writes).filter((path) => path.includes('config.json'))).toEqual([])
})

function promptInput(text: string): PromptSubmitInput {
  return { text, wait: false, origin: { kind: 'composer' } }
}

// The clear runs unawaited once the submit is answered, so the test waits for it to land
async function settled(isDone: () => boolean): Promise<void> {
  for (let tries = 0; tries < 500 && !isDone(); tries += 1) await Promise.resolve()
}

const ROUTING_ON = { isDefault: true, isOnboarded: true }

test('subagent: general-purpose is capped at moderate, other types keep the classifier pick', async ($, on) => {
  const seen = engineStub(on, { classifyAnswer: 'hardest', store: ROUTING_ON })
  await $.session.start(sessionStart())
  await $.agent.spawn(spawnInput({ subagentType: 'general-purpose' }))
  await stepRun($, stepInput('t20', 'agent-1'))
  await $.agent.spawn(spawnInput({ subagentType: 'Explore' }))
  expect(seen.spawnModels).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5'])
  expect(seen.stepEfforts).toEqual(['high'])
})

test('subagent: a general-purpose pick below the ceiling stays cheap', async ($, on) => {
  const seen = engineStub(on, { classifyAnswer: 'trivial', store: ROUTING_ON })
  await $.session.start(sessionStart())
  await $.agent.spawn(spawnInput({ subagentType: 'general-purpose' }))
  expect(seen.spawnModels).toEqual(['claude-haiku-5-5'])
})

test('new task: Clear runs /clear, keeps routing on and resends the prompt as the user', async ($, on) => {
  const seen = engineStub(on, { taskAnswer: TASK_NEW, askAnswer: CLEAR_YES, messagesTokens: 182000, store: ROUTING_ON })
  await $.session.start(sessionStart('terminal'))
  const result = await $.prompt.submit(promptInput('write a haiku about cats'))
  expect(result.drop).toMatch(/clearing the old context/)
  await settled(() => seen.submits.length > 0)
  // No route yet, so the price is the session model's (fable)
  expect(seen.asks).toEqual(['New task detected. Clearing 182k tokens of old context saves about $0.18 per request, $2.27 when the router changes model. Clear first?'])
  expect(seen.commands).toEqual(['clear'])
  expect(seen.submits.map((submit) => [submit.text, submit.origin])).toEqual([['write a haiku about cats', { kind: 'plugin', name: 'cc-model-router', asUser: true }]])
  expect(seen.writes['/home/me/.claude/cc-model-router/sessions/sess-1.json']).toMatch(/"isRouting":true/)
})

test('new task: Keep context sends the prompt as typed', async ($, on) => {
  const seen = engineStub(on, { taskAnswer: TASK_NEW, askAnswer: CLEAR_NO, messagesTokens: 182000, store: ROUTING_ON })
  await $.session.start(sessionStart('terminal'))
  const result = await $.prompt.submit(promptInput('write a haiku about cats'))
  expect(result.text).toBe('write a haiku about cats')
  expect(seen.asks).toHaveLength(1)
  expect(seen.commands).toEqual([])
})

test('new task: a follow-up, a small context or routing off never asks', async ($, on) => {
  const seen = engineStub(on, { taskAnswer: TASK_SAME, askAnswer: CLEAR_YES, messagesTokens: 182000, store: ROUTING_ON })
  await $.session.start(sessionStart('terminal'))
  await $.prompt.submit(promptInput('now add a test for it'))
  expect(seen.taskClassifies).toBe(1)
  await $.command.run(commandInput('cc-model-router', 'off'))
  await $.prompt.submit(promptInput('write a haiku about cats'))
  expect(seen.taskClassifies).toBe(1)
  expect(seen.asks).toEqual([])
})

test('new task: under the token floor the classifier is never called', async ($, on) => {
  const seen = engineStub(on, { taskAnswer: TASK_NEW, askAnswer: CLEAR_YES, messagesTokens: 5000, store: ROUTING_ON })
  await $.session.start(sessionStart('terminal'))
  const result = await $.prompt.submit(promptInput('write a haiku about cats'))
  expect(result.text).toBe('write a haiku about cats')
  expect(seen.taskClassifies).toBe(0)
})
