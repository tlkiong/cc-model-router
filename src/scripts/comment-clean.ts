// lint-staged hands staged paths as argv; the skill decides what to rewrite

const files = process.argv.slice(2).filter(function isSource(path) {
  return /\.(ts|tsx|js|mjs|cjs)$/.test(path)
})

if (files.length === 0) process.exit(0)

const proc = Bun.spawn(['claude', '-p', `/comment-clean ${files.join(' ')}`, '--permission-mode', 'acceptEdits'], {
  stdout: 'inherit',
  stderr: 'inherit',
})

process.exit(await proc.exited)
