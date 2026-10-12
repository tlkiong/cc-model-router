import type { BoxProps, ButtonProps, ElementConstructor, RenderElement, TextProps } from 'claude-code'
import { LABEL } from './routing'
import { modelIdNormalize } from './tiers'

export const PICKER_PANE = 'cc-model-router-picker'

export type TreeElements = { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps>; Button: ElementConstructor<ButtonProps> }

export type PickerRow = { key: string; label: string; isSelected: boolean; isDefault: boolean; onPress: () => void | Promise<void> }

export type PickerRowsInput = {
  sessionModel: string
  tierModels: readonly string[]
  isRouting: boolean
  isDefault: boolean
  onDefault: () => void | Promise<void>
  onRouter: () => void | Promise<void>
  onModel: (model: string) => void | Promise<void>
}

export function pickerRows(input: PickerRowsInput): PickerRow[] {
  const session = modelIdNormalize(input.sessionModel)
  const isSessionOnTier = !input.isRouting && input.tierModels.some((model) => modelIdNormalize(model) === session)
  const rows: PickerRow[] = [
    { key: 'default', label: `Default (${input.sessionModel})`, isSelected: !input.isRouting && !isSessionOnTier, isDefault: false, onPress: input.onDefault },
    { key: 'router', label: LABEL, isSelected: input.isRouting, isDefault: input.isDefault, onPress: input.onRouter },
  ]
  for (const model of input.tierModels) {
    rows.push({ key: model, label: model, isSelected: !input.isRouting && modelIdNormalize(model) === session, isDefault: false, onPress: () => input.onModel(model) })
  }
  return rows
}

export type PickerTreeInput = { rows: PickerRow[]; tableLines: readonly string[]; classifierLine: string; configLine: string }

export function pickerTree({ Box, Text, Button }: TreeElements, input: PickerTreeInput): RenderElement {
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        {input.rows.map((row, index) => (
          <Button key={row.key} plain hotkey={index < 9 ? String(index + 1) : undefined} variant={row.isSelected ? 'primary' : undefined} onPress={row.onPress}>
            {row.isSelected ? '✓ ' : '  '}
            {row.label}
            {row.isDefault ? <Text dimColor> default</Text> : null}
            {row.isSelected ? <Text dimColor> selected</Text> : null}
          </Button>
        ))}
      </Box>
      <Box flexDirection="column">
        {input.tableLines.map((line) => (
          <Text key={line} dimColor>
            {line}
          </Text>
        ))}
        <Text dimColor>{input.classifierLine}</Text>
        <Text dimColor>{input.configLine}</Text>
      </Box>
    </Box>
  )
}
