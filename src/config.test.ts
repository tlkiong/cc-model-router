import { expect, test } from 'claude-code/testing'
import { configDefault, configParse, configText } from './config'

test('config: the default round-trips through text', async () => {
  const { config, errors } = configParse(configText(configDefault))
  expect(errors).toEqual([])
  expect(config).toEqual(configDefault)
})

test('config: a missing classifier block falls back to auto', async () => {
  const { config, errors } = configParse(JSON.stringify({ tiers: configDefault.tiers }))
  expect(errors).toEqual([])
  expect(config?.classifier).toEqual({ kind: 'auto', model: '' })
})

test('config: every invalid field is named', async () => {
  const text = JSON.stringify({
    tiers: [{ name: 'a', model: 'claude-haiku-5-5', effort: 'low', criteria: 'x' }, { name: 'a', model: '', effort: 'turbo', criteria: '' }, 'not an object'],
    classifier: { kind: 'gpt', model: 3 },
  })
  const { config, errors } = configParse(text)
  expect(config).toBeNull()
  expect(errors).toContain('tiers[1].name "a" is used twice')
  expect(errors).toContain('tiers[1].model must be a non-empty string')
  expect(errors).toContain('tiers[1].effort must be one of low, medium, high, xhigh, max')
  expect(errors).toContain('tiers[1].criteria must be a non-empty string')
  expect(errors).toContain('tiers[2] must be an object')
  expect(errors).toContain('classifier.kind must be one of auto, jev, claude')
  expect(errors).toContain('classifier.model must be a string')
})

test('config: empty tiers and bad JSON are refused', async () => {
  expect(configParse('{"tiers":[]}').errors).toEqual(['tiers must be a non-empty array'])
  expect(configParse('{').config).toBeNull()
  expect(configParse('[]').errors).toEqual(['top level must be an object'])
})

test('config: a fifth tier is accepted in file order', async () => {
  const tiers = [...configDefault.tiers, { name: 'review', model: 'claude-opus-5-5', effort: 'max' as const, criteria: 'code review' }]
  const { config } = configParse(JSON.stringify({ tiers }))
  expect(config?.tiers.map((tier) => tier.name)).toEqual(['trivial', 'moderate', 'complex', 'hardest', 'review'])
})
