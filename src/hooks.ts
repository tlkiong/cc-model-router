// The engine follows $ only inside the file that declares a hook, so every $ call lives here and the other modules stay pure
import type { EngineInterface, Register } from 'claude-code'
import { atom, read, update } from 'claude-code'
import { type ClassifierLive, classifierLabel, classifierPick, claudePromptBuild } from './classify'
import { type Config, configDefault, configParse, configPath, configText, type Tier } from './config'
import { JEV_KEY_ENV, JEV_URL, jevHeaders, jevIsRetryable, jevRequestBuild, jevResponseParse } from './jev'
import { PICKER_PANE, pickerRows, pickerTree } from './model-picker'
import { ONBOARDING_PANE, onboardingTree } from './onboarding'
import { LABEL, PLUGIN, type Route, routeDrop, routeGet, routeSet, STORE_IS_DEFAULT, STORE_IS_ONBOARDED, stateFilePath, stateFileText } from './routing'
import { tierFind, tierModels, tierTableLines } from './tiers'

const COMMAND = PLUGIN

// The engine's scan reads atoms only from the hooks file, with literal plugin and key
const isRoutingAtom = atom({ plugin: 'cc-model-router', key: 'isRouting' } as const, false)
const lastRouteAtom = atom({ plugin: 'cc-model-router', key: 'lastRoute' } as const, null as Route | null)

// A bad edit keeps the last good config in use, so one typo never strands a turn on the session model
let configLastGood: Config = configDefault
let configErrors: string[] = []

async function homeRead($: EngineInterface): Promise<string> {
  return (await $.env.get('HOME')) ?? '~'
}

async function configLoad($: EngineInterface): Promise<Config> {
  const path = configPath(await homeRead($))
  if (!(await $.fs.exists(path))) {
    await $.fs.write(path, configText(configDefault))
    configLastGood = configDefault
    configErrors = []
    return configLastGood
  }
  const text = (await $.fs.read(path)) as string
  const { config, errors } = configParse(text)
  configErrors = errors
  if (config) configLastGood = config
  return configLastGood
}

async function classifierResolve($: EngineInterface, config: Config): Promise<ClassifierLive> {
  return classifierPick(config.classifier.kind, Boolean(await $.env.get('TYPESAFE_API_KEY')))
}

async function jevTierAsk($: EngineInterface, config: Config, text: string): Promise<Tier | undefined> {
  const key = await $.env.get('TYPESAFE_API_KEY')
  if (!key) throw new Error(`${JEV_KEY_ENV} is not set`)
  const init = { method: 'POST', headers: jevHeaders(key), body: jevRequestBuild(config, text) }
  let response = await $.http.fetch(JEV_URL, init)
  if (jevIsRetryable(response.status)) {
    // Jev asks for backoff on 429 and 529; one retry keeps a burst from costing the turn its route
    await $.clock.sleep(1000)
    response = await $.http.fetch(JEV_URL, init)
  }
  if (!response.ok) throw new Error(`jev responded ${response.status}`)
  const choice = jevResponseParse(
    response.text,
    config.tiers.map((tier) => tier.name),
  )
  return choice ? tierFind(config, choice.tier) : undefined
}

async function claudeTierAsk($: EngineInterface, config: Config, text: string): Promise<Tier | undefined> {
  const model = config.classifier.model || undefined
  const name = await $.model.classify(
    claudePromptBuild(config, text),
    config.tiers.map((tier) => tier.name),
    model ? { model } : undefined,
  )
  return tierFind(config, name)
}

async function tierClassify($: EngineInterface, config: Config, text: string): Promise<Tier | undefined> {
  if ((await classifierResolve($, config)) === 'jev') {
    try {
      const tier = await jevTierAsk($, config, text)
      if (tier) return tier
    } catch (error) {
      $.ui.log(`${PLUGIN}: jev failed (${error instanceof Error ? error.message : String(error)}), using claude`, { to: 'debug' })
    }
  }
  return claudeTierAsk($, config, text)
}

async function stateFileWrite($: EngineInterface, override: { isRouting?: boolean } = {}): Promise<void> {
  // Status line scripts read the state file; a failed write must never cost the turn its route
  try {
    const isRouting = override.isRouting ?? (await read($, isRoutingAtom))
    const route = await read($, lastRouteAtom)
    await $.fs.write(stateFilePath(await homeRead($), await $.session.id()), stateFileText(isRouting, route, Date.now()))
  } catch (error) {
    $.ui.log(`${PLUGIN}: state file not written (${error instanceof Error ? error.message : String(error)})`, { to: 'debug' })
  }
}

async function routingSet($: EngineInterface, isOn: boolean, options: { isDefault?: boolean } = {}): Promise<void> {
  await update($, isRoutingAtom, () => isOn)
  if (options.isDefault !== undefined) await $.store.set(STORE_IS_DEFAULT, options.isDefault)
  await stateFileWrite($)
}

async function routeApply($: EngineInterface, route: Route): Promise<void> {
  await update($, lastRouteAtom, () => route)
  await stateFileWrite($)
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
  await $.ui.open({ id: ONBOARDING_PANE, title: LABEL, focus: true, closeOnEscape: true, holdToasts: true, rows: 24 })
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

export const register: Register = function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: `${LABEL}: on, off, status, config, onboard`, argumentHint: 'on | off | status | config | onboard' })
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
      const route = { tier: tier.name, model: tier.model, effort: tier.effort }
      routeSet({ turnId: e.turnId }, route)
      await routeApply($, route)
    } catch (error) {
      $.ui.log(`${PLUGIN}: classify failed (${error instanceof Error ? error.message : String(error)}), this turn stays on the session model`)
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    // A caller's explicit model wins and a fork always inherits, so only an undecided spawn is routed
    if (e.fork || e.model !== undefined || !(await isRoutingRead($))) return next(e)
    const tier = await tierClassify($, await configLoad($), e.prompt)
    if (!tier) return next(e)
    const result = await next({ ...e, model: tier.model })
    if (result.agentId) routeSet({ agentId: result.agentId }, { tier: tier.name, model: tier.model, effort: tier.effort })
    $.ui.log(`${PLUGIN}: subagent "${e.description}" -> ${tier.name} (${tier.model} / ${tier.effort})`)
    return result
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const route = routeGet(e.agentId ? { agentId: e.agentId } : { turnId: e.turnId })
    if (!route) return yield* next(e)
    return yield* next({ ...e, model: route.model, effort: route.effort })
  })

  on('turn.complete', async ($, e, next) => {
    routeDrop(e.agentId ? { agentId: e.agentId } : { turnId: e.turnId })
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
    await stateFileWrite($, { isRouting: false })
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
      case 'onboard':
        await onboardingOpen($)
        return { text: `${LABEL}: onboarding opened.` }
      default:
        return { text: await statusReport($) }
    }
  })

  on('command.run', { command: 'model' }, async ($, e, next) => {
    if (e.args.trim().length > 0) {
      const result = await next(e)
      await routingSet($, false)
      return result
    }
    await $.ui.open({ id: PICKER_PANE, title: 'Select model', focus: true, closeOnEscape: true, holdToasts: true, rows: 16 })
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
