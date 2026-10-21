import type { PromptSubmitInput } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { clearQuestion, historyLines, isNewTaskCheckable, taskStateBuild } from './clear'

function submit(extra: Partial<PromptSubmitInput> = {}): PromptSubmitInput {
  return { text: 'write a haiku about cats', wait: false, origin: { kind: 'composer' }, ...extra }
}

test('isNewTaskCheckable: only a plain typed prompt on an idle session', async () => {
  expect(isNewTaskCheckable(submit())).toBe(true)
  expect(isNewTaskCheckable(submit({ turnId: 't1' }))).toBe(false)
  expect(isNewTaskCheckable(submit({ origin: { kind: 'sdk' } }))).toBe(false)
  expect(isNewTaskCheckable(submit({ attachments: [{ type: 'image' }] }))).toBe(false)
  expect(isNewTaskCheckable(submit({ text: 'explain @src/hooks.ts' }))).toBe(false)
  expect(isNewTaskCheckable(submit({ text: '/clear' }))).toBe(false)
  expect(isNewTaskCheckable(submit({ text: '   ' }))).toBe(false)
  expect(isNewTaskCheckable(submit({ text: 'mail me at a@b.com' }))).toBe(true)
})

test('historyLines: latest spoken messages first, tool-only rows skipped, each cut short', async () => {
  const lines = historyLines([
    { role: 'user', text: 'fix the login bug' },
    { role: 'assistant', text: '' },
    { role: 'assistant', text: `done ${'x'.repeat(2000)}` },
  ])
  expect(lines).toHaveLength(2)
  expect(lines[0]?.startsWith('assistant: done')).toBe(true)
  expect(lines[0]?.length).toBe('assistant: '.length + 600)
  expect(lines[1]).toBe('user: fix the login bug')
  expect(taskStateBuild('new thing', lines).startsWith('New prompt:\nnew thing')).toBe(true)
})

test('clearQuestion: tokens and dollars for a priced model, tokens alone otherwise, always a question', async () => {
  expect(clearQuestion(182_000, 'claude-opus-5-5')).toBe('New task detected. Clearing 182k tokens of old context saves about $0.07 per request, $0.91 when the router changes model. Clear first?')
  expect(clearQuestion(30_000, 'some-model')).toBe('New task detected. Clear 30k tokens of old context first?')
})
