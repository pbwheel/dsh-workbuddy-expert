/**
 * The `/expert` command (ticket 02 listing + ticket 03 switching).
 *
 *   /expert          → the discovered expert table (valid + broken rows)
 *   /expert <id>     → the serialized soft-switch transaction (src/switch.js)
 *   /expert off      → remove the session's expert (dispose + default agent)
 *
 * Registration uses the VERIFIED `commands` contract (design §11 #4):
 *   ctx.commands.register({ name, description, input?, recordInput?,
 *     handler(invocation: { commandId, agent, rawInput, attachments, signal })
 *       → { kind: 'success' | 'error', text } | Promise<…> }) → disposer
 *
 * The seam stays defensive: when `ctx.get('commands')` is absent (plain test
 * doubles) the command warns ONCE and stays inert. The live wiring mounts
 * this through a staged `ctx.inject(['commands'], …)` (src/index.js), so a
 * late-registering service still gets the command.
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
 * available (the single contract seam).
 * @param {object} ctx - cordis context
 * @param {{list: () => Promise<{experts: object[], warnings: string[]}>}} registry
 * @param {{
 *   switch: (agent: object, nextId: string) => Promise<{kind: string, text: string}>,
 *   clear: (agent: object) => Promise<{kind: string, text: string}>,
 * }} switcher
 * @param {string[]} [rootPaths] - discovery roots for the empty-state hint
 * @returns {() => void} disposer unregistering the command (no-op when absent)
 */
export function registerExpertCommand(ctx, registry, switcher, rootPaths = []) {
  const commands = typeof ctx.get === 'function' ? ctx.get('commands') : undefined
  if (commands === undefined || typeof commands.register !== 'function') {
    ctx.logger?.warn?.(
      'dsh-workbuddy-expert: the commands service is not available — /expert is not registered; '
      + 'ctx.experts.list() remains usable (the live wiring stages this call through ctx.inject, '
      + 'so a late-registering service still gets the command).',
    )
    return () => {}
  }
  return commands.register({
    name: COMMAND_NAME,
    description: 'List discovered experts; /expert <id> soft-switches this session\'s expert role and skills; /expert off removes it.',
    handler: async (invocation) => {
      const argument = typeof invocation?.rawInput === 'string' ? invocation.rawInput.trim() : ''
      const result = await registry.list()
      const text = renderExpertList(result, rootPaths)
      if (argument === '') {
        return { kind: 'success', text }
      }
      const agent = invocation?.agent
      if (argument === 'off') {
        if (agent === undefined || agent === null) {
          return { kind: 'error', text: '/expert off: 当前命令缺少 agent 上下文，无法移除专家。' }
        }
        return switcher.clear(agent)
      }
      if (agent === undefined || agent === null) {
        return { kind: 'error', text: `/expert ${argument}: 当前命令缺少 agent 上下文，无法切换。当前专家：\n${text}` }
      }
      return switcher.switch(agent, argument)
    },
  })
}
