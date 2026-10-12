import type { AgentSpawnInput, CommandRunInput, On, SessionStartInput, TurnCompleteInput, TurnStepInput } from 'claude-code'
import { type Engine, expect, mock, test } from 'claude-code/testing'
import { configDefault, configText } from './config'

type Seen = {
  stepModels: string[]
  stepEfforts: (string | number | undefined)[]
  spawnModels: (string | undefined)[]
  commands: string[]
  writes: Record<string, string>
  opens: number
}

type StubOptions = { classifyAnswer?: string; hasConfigFile?: boolean; env?: Record<string, string>; store?: Record<string, unknown> }

const SESSION_MODEL = 'claude-fable-5-1[1m]'
const ENGINE = { plugin: 'engine', tier: 'core' } as const

// every $ call the plugin makes needs an answer, so one stub plays the engine for every scenario
function engineStub(on: On, options: StubOptions = {}): Seen {
  const seen: Seen = { stepModels: [], stepEfforts: [], spawnModels: [], commands: [], writes: {}, opens: 0 }
  // a real sleep stalls the 429 retry test on the mocked clock, so sleep answers at once
  on('clock.sleep', () => ({ value: undefined }))
  mock.env(on, { HOME: '/home/me', ...(options.env ?? {}) })
  mock.store(on, options.store ?? { isOnboarded: true })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.model', () => ({ value: SESSION_MODEL }))
  on('fs.exists', () => ({ value: options.hasConfigFile ?? true }))
  on('fs.read', () => ({ value: configText(configDefault) }))
  on('fs.write', ($, e) => {
    seen.writes[e.path] = e.text
    return { value: undefined }
  })
  on('model.classify', () => ({ value: options.classifyAnswer ?? 'trivial' }))
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

test('routing on: the hardest tier reaches fable at xhigh', async ($, on) => {
  const seen = engineStub(on, { classifyAnswer: 'hardest', store: { isDefault: true, isOnboarded: true } })
  await $.session.start(sessionStart())
  await $.turn.start({ text: 'redesign the auth architecture', turnId: 't2' })
  await stepRun($, stepInput('t2'))
  expect(seen.stepModels).toEqual(['claude-fable-5-1'])
  expect(seen.stepEfforts).toEqual(['xhigh'])
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
  expect(seen.stepEfforts).toEqual(['medium'])
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
  const seen = engineStub(on)
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
  expect(seen.stepEfforts).toEqual(['high'])
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
  expect(seen.stepModels).toEqual(['claude-fable-5-1', 'claude-haiku-5-5'])
  expect(statuses).toEqual([])
})
