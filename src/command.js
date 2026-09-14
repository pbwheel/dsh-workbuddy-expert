/**
 * The `/expert` command, listing half (ticket 02): `/expert` with NO argument
 * renders the discovered expert table — valid cards plus broken rows with
 * their reasons. `/expert <name>` switching is a later ticket; until then an
 * argument answers with an explicit not-yet error that still shows the list.
 *
 * Registration is isolated in `registerExpertCommand` so the (unverified at
 * authoring time) `commands` service contract can be adjusted in one place:
 * resolve it defensively via `ctx.get('commands')`, register only when the
 * service and its `register` method are present, and otherwise warn ONCE and
 * stay inert — never a hard failure, never an HTTP fallback.
 */

export const COMMAND_NAME = 'expert'

/**
 * Render the expert table for command/chat display.
 * @param {{experts: object[], warnings: string[]}} result
 * @param {string[]} [rootPaths] - discovery roots for the empty-state hint
 * @returns {string}
 */
export function renderExpertList(result, rootPaths = []) {
  const experts = result.experts ?? []
  const valid = experts.filter((expert) => expert.broken === undefined)
  const broken = experts.filter((expert) => expert.broken !== undefined)
  const lines = []
  lines.push(`Experts: ${String(valid.length)} available${broken.length > 0 ? `, ${String(broken.length)} broken` : ''}.`)
  if (valid.length > 0) {
    for (const expert of valid) {
      const bits = [`- ${expert.id}`]
      if (expert.displayName !== undefined && expert.displayName !== expert.id) bits.push(`  ${expert.displayName}`)
      if (typeof expert.description === 'string' && expert.description !== '') bits.push(` — ${expert.description}`)
      const skills = Array.isArray(expert.skills) ? expert.skills : []
      bits.push(` [${expert.root}${skills.length > 0 ? `, ${String(skills.length)} skill${skills.length === 1 ? '' : 's'}` : ''}]`)
      lines.push(bits.join(''))
    }
  }
  if (broken.length > 0) {
    lines.push('Broken (not loadable):')
    for (const expert of broken) {
      lines.push(`- ${expert.id}  ⚠ ${expert.broken} [${expert.root}]`)
    }
  }
  if (experts.length === 0) {
    lines.push(rootPaths.length > 0
      ? `No experts found under:${rootPaths.map((path) => `\n  ${path}`).join('')}`
      : 'No experts found.')
  }
  for (const warning of result.warnings ?? []) {
    lines.push(`⚠ ${warning}`)
  }
  return lines.join('\n')
}

/**
 * Register the `/expert` command against the `commands` service when it is
 * available. Defensive on purpose: the exact contract is verified by a later
 * ticket, so this function is the single seam to adjust.
 * @param {object} ctx - cordis context
 * @param {{list: () => Promise<{experts: object[], warnings: string[]}>}} registry
 * @param {string[]} [rootPaths] - discovery roots for the empty-state hint
 * @returns {() => void} disposer unregistering the command (no-op when absent)
 */
export function registerExpertCommand(ctx, registry, rootPaths = []) {
  const commands = typeof ctx.get === 'function' ? ctx.get('commands') : undefined
  if (commands === undefined || typeof commands.register !== 'function') {
    ctx.logger?.warn?.(
      'dsh-workbuddy-expert: the commands service is not available — /expert is not registered; '
      + 'ctx.experts.list() remains usable and registration retries are unnecessary (the plugin inertly waits).',
    )
    return () => {}
  }
  return commands.register({
    name: COMMAND_NAME,
    description: 'List discovered experts (no argument); /expert <id> switching arrives in a later ticket.',
    handler: async (invocation) => {
      const argument = typeof invocation?.rawInput === 'string' ? invocation.rawInput.trim() : ''
      const result = await registry.list()
      const text = renderExpertList(result, rootPaths)
      if (argument !== '') {
        return {
          kind: 'error',
          text: `/expert ${argument}: switching experts is not implemented yet (a later ticket). Current experts:\n${text}`,
        }
      }
      return { kind: 'success', text }
    },
  })
}
