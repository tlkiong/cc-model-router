import type { RenderElement } from 'claude-code'
import type { TreeElements } from './model-picker'
import { LABEL } from './routing'

export const ONBOARDING_PANE = 'cc-model-router-onboarding'

export type OnboardingTreeInput = {
  tableLines: readonly string[]
  classifierLine: string
  configLine: string
  stateLine: string
  onEnable: () => void | Promise<void>
  onDismiss: () => void | Promise<void>
}

export function onboardingTree({ Box, Text, Button }: TreeElements, input: OnboardingTreeInput): RenderElement {
  return (
    <Box flexDirection="column" gap={1}>
      <Text>{LABEL} sends each turn and each subagent to the cheapest tier whose criteria fit the prompt.</Text>
      <Box flexDirection="column">
        <Text bold>Tiers</Text>
        {input.tableLines.map((line) => (
          <Text key={line}>{line}</Text>
        ))}
      </Box>
      <Text>{input.classifierLine}</Text>
      <Box flexDirection="column">
        <Text>{input.configLine}</Text>
        <Text>{input.stateLine}</Text>
      </Box>
      <Box flexDirection="column">
        <Text>/model option 2 turns it on. Picking any other model there turns it off.</Text>
        <Text>/cc-model-router status shows the live route. /cc-model-router config shows the tier file.</Text>
      </Box>
      <Box gap={2}>
        <Button key="enable" hotkey="1" variant="primary" label={`Enable ${LABEL}`} onPress={input.onEnable} />
        <Button key="dismiss" hotkey="2" role="dismiss" label="Keep current model" onPress={input.onDismiss} />
      </Box>
      <Text dimColor>Reopen anytime with /cc-model-router onboard</Text>
    </Box>
  )
}
