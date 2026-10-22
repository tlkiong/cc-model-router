import { expect, test } from 'claude-code/testing'
import { configDefault } from './config'
import { contextCost, tierCap, tierFind } from './tiers'

function tier(name: string) {
  return tierFind(configDefault, name)
}

test('tierCap: a general-purpose pick above the ceiling drops to it, one below stays', async () => {
  expect(tierCap(configDefault, 'general-purpose', tier('hardest'))?.name).toBe('moderate')
  expect(tierCap(configDefault, 'general-purpose', tier('trivial'))?.name).toBe('trivial')
})

test('tierCap: no pick falls to the ceiling, an agent type without one keeps its pick', async () => {
  expect(tierCap(configDefault, 'general-purpose', undefined)?.name).toBe('moderate')
  expect(tierCap(configDefault, 'Explore', tier('hardest'))?.name).toBe('hardest')
  expect(tierCap(configDefault, 'Explore', undefined)).toBeUndefined()
})

test('tierCap: a ceiling naming a tier the config lacks is skipped', async () => {
  const config = { ...configDefault, subagents: { 'general-purpose': 'gone' } }
  expect(tierCap(config, 'general-purpose', tier('hardest'))?.name).toBe('hardest')
})

test('contextCost: cache read and cache write of the context at the model input price', async () => {
  const cost = contextCost('opus', 100_000)
  expect(Math.round((cost?.readUsd ?? 0) * 100)).toBe(4)
  expect(Math.round((cost?.writeUsd ?? 0) * 100)).toBe(50)
  expect(contextCost('unknown-model', 100_000)).toBeUndefined()
})
