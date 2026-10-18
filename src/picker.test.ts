import { expect, test } from 'claude-code/testing'
import { configDefault } from './config'
import { pickerRows } from './model-picker'
import { stateFileText } from './routing'
import { modelIdNormalize, modelIdResolve, priceText, tierTableLines } from './tiers'

const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1']
const noop = () => undefined

test('picker: router row is option 2 and reads selected while routing', async () => {
  const rows = pickerRows({ sessionModel: 'claude-fable-5-1[1m]', tierModels: MODELS, isRouting: true, isDefault: true, onDefault: noop, onRouter: noop, onModel: noop })
  expect(rows[1]?.label).toBe('CC Model Router')
  expect(rows[1]?.isSelected).toBe(true)
  expect(rows[1]?.isDefault).toBe(true)
  expect(rows.filter((row) => row.isSelected)).toHaveLength(1)
  expect(rows).toHaveLength(2 + MODELS.length)
})

test('picker: a manual pick marks that tier model, not Default', async () => {
  const rows = pickerRows({ sessionModel: 'claude-opus-5-5', tierModels: MODELS, isRouting: false, isDefault: true, onDefault: noop, onRouter: noop, onModel: noop })
  expect(rows[0]?.isSelected).toBe(false)
  expect(rows[1]?.isSelected).toBe(false)
  expect(rows[1]?.isDefault).toBe(true)
  expect(rows.find((row) => row.key === 'claude-opus-5-5')?.isSelected).toBe(true)
})

test('picker: a session model outside the tiers marks Default', async () => {
  const rows = pickerRows({ sessionModel: 'claude-sonnet-4-6', tierModels: MODELS, isRouting: false, isDefault: false, onDefault: noop, onRouter: noop, onModel: noop })
  expect(rows[0]?.isSelected).toBe(true)
  expect(rows[0]?.label).toBe('Default')
  expect(rows.filter((row) => row.isSelected)).toHaveLength(1)
})

test('tiers: aliases and the 1m suffix normalise to one id', async () => {
  expect(modelIdNormalize('claude-fable-5-1[1m]')).toBe('claude-fable-5-1')
  expect(modelIdNormalize('opus')).toBe('claude-opus-5-5')
  expect(modelIdResolve('opus[1m]')).toBe('claude-opus-5-5[1m]')
  expect(modelIdResolve('claude-haiku-5-5')).toBe('claude-haiku-5-5')
  expect(priceText('haiku')).toBe('$0.10/$0.50 per MTok')
  expect(priceText('claude-unknown-9')).toBe('')
})

test('tiers: the table has one line per tier with model and effort', async () => {
  const lines = tierTableLines(configDefault)
  expect(lines).toHaveLength(5)
  expect(lines[0]).toMatch(/^trivial\s+claude-haiku-5-5\s+low\s+\$0\.10\/\$0\.50 per MTok$/)
})

test('routing: the state file names the router for status lines', async () => {
  const text = stateFileText(true, { tier: 'trivial', model: 'claude-haiku-5-5', effort: 'low' }, 1)
  expect(JSON.parse(text)).toEqual({ isRouting: true, label: 'CC Model Router', tier: 'trivial', model: 'claude-haiku-5-5', effort: 'low', updatedAt: 1 })
  expect(JSON.parse(stateFileText(false, null, 2))).toMatchObject({ isRouting: false, tier: null, model: null })
})
