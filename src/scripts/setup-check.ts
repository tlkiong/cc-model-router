// Fails early with install hints so `make setup` never leaves a half-working dev environment

type Check = { name: string; isOk: boolean; hint: string; isRequired: boolean }

async function commandExists(name: string): Promise<boolean> {
  const proc = Bun.spawn(['which', name], { stdout: 'ignore', stderr: 'ignore' })
  return (await proc.exited) === 0
}

async function fileExists(globPattern: string): Promise<boolean> {
  const home = process.env.HOME ?? ''
  const glob = new Bun.Glob(globPattern)
  for await (const _ of glob.scan({ cwd: home, absolute: true, onlyFiles: true, dot: true })) return true
  return false
}

const checks: Check[] = [
  { name: 'bun', isOk: await commandExists('bun'), hint: 'https://bun.sh', isRequired: true },
  { name: 'claude', isOk: await commandExists('claude'), hint: 'npm i -g @anthropic-ai/claude-code', isRequired: true },
  { name: 'gh', isOk: await commandExists('gh'), hint: 'brew install gh && gh auth login', isRequired: false },
  { name: 'i-have-adhd skill', isOk: await fileExists('.claude/plugins/**/i-have-adhd/SKILL.md'), hint: '/plugin install i-have-adhd --marketplace ayghri/i-have-adhd', isRequired: false },
  { name: 'no-ai-slop skill', isOk: await fileExists('.claude/skills/no-ai-slop/SKILL.md'), hint: 'add the no-ai-slop skill under ~/.claude/skills', isRequired: false },
]

let hasFailure = false
for (const check of checks) {
  console.log(`${check.isOk ? 'ok  ' : 'MISS'} ${check.name}${check.isOk ? '' : `  ->  ${check.hint}`}`)
  if (!check.isOk && check.isRequired) hasFailure = true
}

process.exit(hasFailure ? 1 : 0)
