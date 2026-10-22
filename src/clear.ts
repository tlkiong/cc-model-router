import type { PromptSubmitInput, SessionContextBreakdown } from 'claude-code'
import type { Choice } from './classify'
import { contextCost, tokensText, usdEstimateText } from './tiers'

export type HistoryMessage = { role: 'user' | 'assistant'; text: string }

export const TASK_SAME = 'same'
export const TASK_NEW = 'new'
export const CLEAR_YES = 'Clear, then run it'
export const CLEAR_NO = 'Keep context'
export const CLEAR_HEADER = 'New task'

// The new prompt leads the state, so a classifier that cuts a long state keeps the part that decides
const PROMPT_MAX_CHARS = 2000
const HISTORY_MAX_CHARS = 600
const HISTORY_COUNT = 6

export function taskChoice(): Choice {
  return {
    key: 'task',
    instructions:
      'A coding assistant got a new prompt in the middle of a conversation. Decide whether the prompt continues the earlier conversation or starts an unrelated task. When unsure, pick same.',
    criteria: {
      [TASK_SAME]: 'follows up on, refers back to, or needs files, decisions or results from the earlier conversation',
      [TASK_NEW]: 'an unrelated task that would go just as well in a fresh conversation with none of the earlier context',
    },
  }
}

// Resubmitting drops attachments and @ mentions, a slash or bang line is not a prompt, and a prompt typed mid-turn belongs to that turn
export function isNewTaskCheckable(e: Pick<PromptSubmitInput, 'text' | 'origin' | 'turnId' | 'attachments'>): boolean {
  if (e.origin.kind !== 'composer' || e.turnId !== undefined || (e.attachments?.length ?? 0) > 0) return false
  return e.text.trim().length > 0 && !/^\s*[/!]/.test(e.text) && !/(^|\s)@\S/.test(e.text)
}

// /clear removes the conversation, not the system prompt or tools, so only the messages row counts as savings
export function messagesTokens(breakdown: SessionContextBreakdown | undefined): number | undefined {
  return breakdown?.categories.find((category) => category.kind === 'used' && category.name.toLowerCase() === 'messages')?.tokens
}

export function historyLines(messages: readonly HistoryMessage[]): string[] {
  const spoken = messages.filter((message) => message.text.trim().length > 0).slice(-HISTORY_COUNT)
  return spoken.reverse().map((message) => `${message.role}: ${message.text.replace(/\s+/g, ' ').trim().slice(0, HISTORY_MAX_CHARS)}`)
}

export function taskStateBuild(text: string, history: readonly string[]): string {
  return `New prompt:\n${text.slice(0, PROMPT_MAX_CHARS)}\n\nEarlier conversation, latest first:\n${history.map((line) => `- ${line}`).join('\n')}`
}

export function clearQuestion(tokens: number, model: string): string {
  const cost = contextCost(model, tokens)
  const amount = `${tokensText(tokens)} tokens of old context`
  if (!cost) return `New task detected. Clear ${amount} first?`
  return `New task detected. Clearing ${amount} saves about ${usdEstimateText(cost.readUsd)} per request, ${usdEstimateText(cost.writeUsd)} when the router changes model. Clear first?`
}
