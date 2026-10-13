import { expect, test } from 'claude-code/testing'
import { configDefault } from './config'
import { jevIsRetryable, jevRequestBuild, jevResponseParse } from './jev'

const TIER_NAMES = configDefault.tiers.map((tier) => tier.name)

test('jev: the request carries one choice question keyed by tier name', async () => {
  const body = JSON.parse(jevRequestBuild(configDefault, 'fix the typo in README'))
  expect(body.state).toBe('fix the typo in README')
  expect(body.model).toBe('jev-latest')
  expect(body.questions.tier.type).toBe('choice')
  expect(Object.keys(body.questions.tier.criteria)).toEqual(TIER_NAMES)
  expect(body.questions.tier.criteria.trivial).toBe(configDefault.tiers[0]?.criteria)
})

test('jev: a configured model id and a long state are honoured', async () => {
  const config = { ...configDefault, classifier: { kind: 'jev' as const, model: 'jev-1.13.0' } }
  const body = JSON.parse(jevRequestBuild(config, 'x'.repeat(20000)))
  expect(body.model).toBe('jev-1.13.0')
  expect(body.state.length).toBe(8000)
})

test('jev: a good answer gives the chosen name', async () => {
  const text = JSON.stringify({ model: 'jev-1.13.0', answers: { tier: { type: 'choice', choice: 'moderate', confidence: 0.82, probabilities: {} } }, usage: {} })
  expect(jevResponseParse(text)).toBe('moderate')
})

test('jev: a malformed body gives no name', async () => {
  expect(jevResponseParse(JSON.stringify({ answers: {} }))).toBeUndefined()
  expect(jevResponseParse('not json')).toBeUndefined()
  expect(jevResponseParse('null')).toBeUndefined()
})

test('jev: only 429 and 529 are retried', async () => {
  expect(jevIsRetryable(429)).toBe(true)
  expect(jevIsRetryable(529)).toBe(true)
  expect(jevIsRetryable(401)).toBe(false)
  expect(jevIsRetryable(500)).toBe(false)
})
