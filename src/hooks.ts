// The engine follows $ only inside the file that declares a hook, so every $ call lives here and the other modules stay pure
import type { EngineInterface, Register } from 'claude-code'
import { atom, read, update } from 'claude-code'
import { type Choice, type ClassifierLive, classifierLabel, classifierPick, claudePromptBuild, tierChoice } from './classify'
import { CLEAR_HEADER, CLEAR_NO, CLEAR_YES, clearQuestion, historyLines, isNewTaskCheckable, messagesTokens, TASK_NEW, taskChoice, taskStateBuild } from './clear'
import { type Config, configDefault, configParse, configPath, configText, type Tier } from './config'
import { JEV_KEY_ENV, JEV_URL, jevHeaders, jevIsRetryable, jevRequestBuild, jevResponseParse } from './jev'
import { PICKER_PANE, pickerHeight, pickerRows, pickerTree } from './model-picker'
import { ONBOARDING_PANE, onboardingHeight, onboardingTree } from './onboarding'
import { LABEL, PLUGIN, type Route, routeBuild, routeDrop, routeGet, routeSet, routesClear, stateFilePath, stateFileText } from './routing'
import { tierCap, tierFind, tierModels, tierTableLines } from './tiers'

const COMMAND = PLUGIN
const COMMAND_ARGS = 'on | off | status | config | update-config | onboard'
const STORE_IS_DEFAULT = 'isDefault'
const STORE_IS_ONBOARDED = 'isOnboarded'

// The engine's scan reads atoms only from the hooks file, with literal plugin and key
const isRoutingAtom = atom({ plugin: 'cc-model-router', key: 'isRouting' } as const, false)
const lastRouteAtom = atom({ plugin: 'cc-model-router', key: 'lastRoute' } as const, null as Route | null)

// A bad edit keeps the last good config in use, so one typo never strands a turn on the session model
let configLastGood: Config = configDefault
let configErrors: string[] = []

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function homeRead($: EngineInterface): Promise<string> {
  // $.fs resolves a path that is not absolute under the project, so a missing HOME must stop the write rather than guess one
  const home = await $.env.get('HOME')
  if (!home) throw new Error('HOME is not set')
  return home
}

async function configLoad($: EngineInterface): Promise<Config> {
  const path = configPath(await homeRead($))
  if (!(await $.fs.exists(path))) {
    await $.fs.write(path, configText(configDefault))
    configLastGood = configDefault
    configErrors = []
    return configLastGood
  }
  let text: string
  try {
    text = await $.fs.read(path)
  } catch (error) {
    configErrors = [`not readable: ${errorText(error)}`]
    return configLastGood
  }
  const { config, errors } = configParse(text)
  configErrors = errors
  if (config) configLastGood = config
  return configLastGood
}

async function jevKeyRead($: EngineInterface): Promise<string | undefined> {
  return $.env.get('TYPESAFE_API_KEY')
}

async function classifierResolve($: EngineInterface, config: Config): Promise<ClassifierLive> {
  return classifierPick(config.classifier.kind, Boolean(await jevKeyRead($)))
}

async function jevChoiceAsk($: EngineInterface, config: Config, choice: Choice, text: string, key: string): Promise<string | undefined> {
  const init = { method: 'POST', headers: jevHeaders(key), body: jevRequestBuild(config.classifier.model, choice, text) }
  let response = await $.http.fetch(JEV_URL, init)
  if (jevIsRetryable(response.status)) {
    // Jev asks for backoff on 429 and 529; one retry keeps a burst from costing the turn its route
    await $.clock.sleep(1000)
    response = await $.http.fetch(JEV_URL, init)
  }
  if (!response.ok) throw new Error(`jev responded ${response.status}`)
  return jevResponseParse(response.text, choice.key)
}

async function claudeChoiceAsk($: EngineInterface, config: Config, choice: Choice, text: string): Promise<string | undefined> {
  const model = config.classifier.model || undefined
  return $.model.classify(claudePromptBuild(choice, text), Object.keys(choice.criteria), model ? { model } : undefined)
}

async function choiceAsk($: EngineInterface, config: Config, choice: Choice, text: string): Promise<string | undefined> {
  const key = await jevKeyRead($)
  if (key && classifierPick(config.classifier.kind, Boolean(key)) === 'jev') {
    try {
      const answer = await jevChoiceAsk($, config, choice, text, key)
      if (answer !== undefined && Object.hasOwn(choice.criteria, answer)) return answer
    } catch (error) {
      $.ui.log(`${PLUGIN}: jev failed (${errorText(error)}), using claude`, { to: 'debug' })
    }
  }
  return claudeChoiceAsk($, config, choice, text)
}

async function tierClassify($: EngineInterface, config: Config, text: string): Promise<Tier | undefined> {
  return tierFind(config, await choiceAsk($, config, tierChoice(config), text))
}

async function clearOffer($: EngineInterface, config: Config, text: string): Promise<boolean> {
  // The token count is local and free, so a small context never pays for a classify call
  const tokens = messagesTokens((await $.session.usage({ breakdown: 'summary' })).context.breakdown)
  if (tokens === undefined || tokens < config.newTask.minTokens) return false
  const history = historyLines(await $.session.messages())
  if (history.length === 0) return false
  if ((await choiceAsk($, config, taskChoice(), taskStateBuild(text, history))) !== TASK_NEW) return false
  const route = await read($, lastRouteAtom)
  const model = route?.model ?? (await $.session.model())
  return (await $.ui.ask(clearQuestion(tokens, model), { options: [CLEAR_YES, CLEAR_NO], header: CLEAR_HEADER })) === CLEAR_YES
}

async function clearThenSubmit($: EngineInterface, text: string): Promise<void> {
  const isRouting = await isRoutingRead($)
  try {
    await $.command.run({ command: 'clear' })
    // /clear goes on under a new session id with no session.start, so the switch and its state file are set again for it
    await routingSet($, isRouting)
    await $.prompt.submit({ text, asUser: true })
  } catch (error) {
    $.ui.log(`${PLUGIN}: clear then send failed (${errorText(error)}), your prompt is back in the box`)
    try {
      await $.prompt.fill({ text })
    } catch (fillError) {
      $.ui.log(`${PLUGIN}: prompt not restored (${errorText(fillError)}): ${text}`)
    }
  }
}

async function stateFileWrite($: EngineInterface, isRouting: boolean): Promise<void> {
  // Status line scripts read the state file; a failed write must never cost the turn its route
  try {
    const route = await read($, lastRouteAtom)
    await $.fs.write(stateFilePath(await homeRead($), await $.session.id()), stateFileText(isRouting, route, Date.now()))
  } catch (error) {
    $.ui.log(`${PLUGIN}: state file not written (${errorText(error)})`, { to: 'debug' })
  }
}

async function routingSet($: EngineInterface, isOn: boolean, options: { isDefault?: boolean } = {}): Promise<void> {
  await update($, isRoutingAtom, () => isOn)
  if (options.isDefault !== undefined) await $.store.set(STORE_IS_DEFAULT, options.isDefault)
  await stateFileWrite($, isOn)
}

async function routeApply($: EngineInterface, route: Route): Promise<void> {
  await update($, lastRouteAtom, () => route)
  await stateFileWrite($, await isRoutingRead($))
}

async function isRoutingRead($: EngineInterface): Promise<boolean> {
  return read($, isRoutingAtom)
}

async function isDefaultRead($: EngineInterface): Promise<boolean> {
  return (await $.store.get(STORE_IS_DEFAULT)) === true
}

async function onboardingOpen($: EngineInterface): Promise<void> {
  // Marked before the pane shows, so an Esc does not bring it back every session
  await $.store.set(STORE_IS_ONBOARDED, true)
  await $.ui.open({ id: ONBOARDING_PANE, title: LABEL, focus: true, closeOnEscape: true, holdToasts: true, rows: onboardingHeight(await configLoad($)) })
}

async function routerEnable($: EngineInterface, paneId: string): Promise<void> {
  await routingSet($, true, { isDefault: true })
  await $.ui.close({ id: paneId })
  $.ui.toast(`${LABEL} on`)
}

async function sessionModelPick($: EngineInterface, model: string): Promise<void> {
  await $.ui.close({ id: PICKER_PANE })
  await $.command.run({ command: 'model', args: model })
}

async function statusReport($: EngineInterface): Promise<string> {
  const config = await configLoad($)
  const route = await read($, lastRouteAtom)
  const lines = [
    `${LABEL}: ${(await isRoutingRead($)) ? 'on' : 'off'}${(await isDefaultRead($)) ? ' (default for new sessions)' : ''}`,
    `last route: ${route ? `${route.tier} -> ${route.model} / ${route.effort}` : 'none yet'}`,
    `classifier: ${classifierLabel(await classifierResolve($, config), config)}`,
    '',
    ...tierTableLines(config),
  ]
  return lines.join('\n')
}

async function configReport($: EngineInterface): Promise<string> {
  const config = await configLoad($)
  const lines = [`config: ${configPath(await homeRead($))}`, 'edits apply on the next turn', '', ...tierTableLines(config)]
  if (configErrors.length > 0) lines.push('', 'the file has errors, the last good config is in use:', ...configErrors.map((error) => `  ${error}`))
  return lines.join('\n')
}

async function configUpdate($: EngineInterface): Promise<string> {
  const path = configPath(await homeRead($))
  const text = configText(configDefault)
  const old = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
  if (old === text) return `${LABEL}: config already matches the defaults.`
  // Custom tiers are replaced too, so the old file stays where the user can copy them back
  if (old) await $.fs.write(`${path}.bak`, old)
  await $.fs.write(path, text)
  configLastGood = configDefault
  configErrors = []
  const lines = [`${LABEL}: config updated to the defaults.`, ...(old ? [`previous file saved to ${path}.bak`] : []), '', ...tierTableLines(configDefault)]
  return lines.join('\n')
}

export const register: Register = function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: `${LABEL}: ${COMMAND_ARGS}`, argumentHint: COMMAND_ARGS })
    await configLoad($)
    await routingSet($, await isDefaultRead($))
    const isOnboarded = (await $.store.get(STORE_IS_ONBOARDED)) === true
    if (!isOnboarded && e.surface !== null) await onboardingOpen($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.text.trim().length === 0 || !(await isRoutingRead($))) return next(e)
    try {
      const tier = await tierClassify($, await configLoad($), e.text)
      if (!tier) {
        $.ui.log(`${PLUGIN}: no tier matched, this turn stays on the session model`)
        return next(e)
      }
      const route = routeBuild(tier)
      routeSet({ turnId: e.turnId }, route)
      await routeApply($, route)
    } catch (error) {
      $.ui.log(`${PLUGIN}: classify failed (${errorText(error)}), this turn stays on the session model`)
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (!isNewTaskCheckable(e) || !(await isRoutingRead($))) return next(e)
    try {
      const config = await configLoad($)
      if (config.newTask.isAsking && (await clearOffer($, config, e.text))) {
        // /clear waits for an idle session, which only comes once this submit is answered, so the clear runs unawaited
        void clearThenSubmit($, e.text)
        return { drop: `${LABEL}: clearing the old context, then sending your prompt` }
      }
    } catch (error) {
      // A dismissed dialog rejects too; either way the prompt goes ahead in the current context
      $.ui.log(`${PLUGIN}: new-task check skipped (${errorText(error)})`, { to: 'debug' })
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    // A caller's explicit model wins, a fork always inherits and a workflow agent ignores a model change, so only an undecided spawn is routed
    if (e.fork || e.workflow || e.model !== undefined || !(await isRoutingRead($))) return next(e)
    const config = await configLoad($)
    let picked: Tier | undefined
    try {
      picked = await tierClassify($, config, e.prompt)
    } catch (error) {
      $.ui.log(`${PLUGIN}: classify failed for subagent "${e.description}" (${errorText(error)})`, { to: 'debug' })
    }
    const tier = tierCap(config, e.subagentType, picked)
    if (!tier) return next(e)
    const route = routeBuild(tier)
    const result = await next({ ...e, model: route.model })
    if (result.agentId) routeSet({ agentId: result.agentId }, route)
    const capNote = tier === picked ? '' : `, capped for ${e.subagentType} from ${picked?.name ?? 'no pick'}`
    $.ui.log(`${PLUGIN}: subagent "${e.description}" -> ${route.tier} (${route.model} / ${route.effort})${capNote}`)
    return result
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const route = routeGet(e.agentId ? { agentId: e.agentId } : { turnId: e.turnId })
    if (!route) return yield* next(e)
    return yield* next({ ...e, model: route.model, effort: route.effort })
  })

  on('turn.complete', async ($, e, next) => {
    // A message can wake a subagent for another run on the same id, so its route stays until the session ends
    if (!e.agentId) routeDrop({ turnId: e.turnId })
    return next(e)
  })

  on('classic.PostModelSwitch', async ($, e, next) => {
    const isManual = e.source === 'command' || e.source === 'picker' || e.source === 'sdk'
    if (isManual && (await isRoutingRead($))) {
      await routingSet($, false)
      $.ui.toast(`${LABEL} off: you picked ${e.to_model}`)
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    routesClear()
    await stateFileWrite($, false)
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const verb = e.args.trim().split(/\s+/)[0] ?? ''
    switch (verb) {
      case 'on':
        await routingSet($, true, { isDefault: true })
        return { text: `${LABEL} on, and the default for new sessions.` }
      case 'off':
        await routingSet($, false, { isDefault: false })
        return { text: `${LABEL} off. /model picks the session model again.` }
      case 'config':
        return { text: await configReport($) }
      case 'update-config':
        return { text: await configUpdate($) }
      case 'onboard':
        await onboardingOpen($)
        return { text: `${LABEL}: onboarding opened.` }
      case '':
      case 'status':
        return { text: await statusReport($) }
      default:
        return { text: `${LABEL}: unknown "${verb}". Use ${COMMAND_ARGS}.` }
    }
  })

  on('command.run', { command: 'model' }, async ($, e, next) => {
    if (e.args.trim().length > 0) {
      const result = await next(e)
      await routingSet($, false)
      return result
    }
    await $.ui.open({ id: PICKER_PANE, title: 'Select model', focus: true, closeOnEscape: true, holdToasts: true, rows: pickerHeight(await configLoad($)) })
    return { text: `${LABEL}: pick a model in the pane.` }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PICKER_PANE }, async ($, e) => {
    const config = await configLoad($)
    const rows = pickerRows({
      sessionModel: await $.session.model(),
      tierModels: tierModels(config),
      isRouting: await isRoutingRead($),
      isDefault: await isDefaultRead($),
      onDefault: () => sessionModelPick($, 'default'),
      onRouter: () => routerEnable($, PICKER_PANE),
      onModel: (model) => sessionModelPick($, model),
    })
    return pickerTree($.ui.resolve(e), {
      rows,
      tableLines: tierTableLines(config),
      classifierLine: `classifier: ${classifierLabel(await classifierResolve($, config), config)}`,
      configLine: `config: ${configPath(await homeRead($))}`,
    })
  })

  on('ui.render', { component: 'Pane', requestId: ONBOARDING_PANE }, async ($, e) => {
    const config = await configLoad($)
    const live = await classifierResolve($, config)
    const home = await homeRead($)
    const label = classifierLabel(live, config)
    return onboardingTree($.ui.resolve(e), {
      tableLines: tierTableLines(config),
      classifierLine:
        live === 'jev' ? `classifier: ${label}, ${JEV_KEY_ENV} found` : `classifier: ${label}. Set ${JEV_KEY_ENV} in your shell or in the env block of ~/.claude/settings.json to use Jev.`,
      configLine: `config: ${configPath(home)} (edits apply on the next turn)`,
      stateLine: `status line state: ${stateFilePath(home, '<session_id>')}`,
      onEnable: () => routerEnable($, ONBOARDING_PANE),
      onDismiss: () => $.ui.close({ id: ONBOARDING_PANE }),
    })
  })
}
