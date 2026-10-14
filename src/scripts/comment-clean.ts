// lint-staged already filters argv to staged .ts and .tsx paths, so they go to the skill unchecked
const proc = Bun.spawn(['claude', '-p', `/comment-clean ${process.argv.slice(2).join(' ')}`, '--permission-mode', 'acceptEdits'], {
  stdout: 'inherit',
  stderr: 'inherit',
})

process.exit(await proc.exited)
