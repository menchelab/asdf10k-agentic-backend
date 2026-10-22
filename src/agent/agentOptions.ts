/**
 * SDK options for a session's live query. Every choice here was confirmed in the phase 0 spike
 * (asdf10k/docs/agent-window-plan.md, section 15).
 */

import type { McpServerConfig, Options } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../config.js';
import { SYSTEM_PROMPT_APPEND } from './systemPrompt.js';
import { readDataDescription, renderDataDescription } from './dataDescription.js';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOG_SKILL_NAME } from './catalogSkill.js';

/**
 * The skills the agent may see: the ones in agent-home/.claude/skills plus the generated catalog
 * skill of the workspace (finding N4: without a list the session also listed Claude Code's bundled
 * skills and the host user's synced ones - update-config, code-review, loop, design ...).
 */
/**
 * Built-in skills the CLI lists even with `skills` set and bundled skills disabled (init.skills,
 * claude-agent-sdk 0.3.291, 2026-10-22): switched off by name. After an SDK update, check the init
 * list (docs/sdk-notes.md) and extend this.
 */
export const BUILTIN_SKILLS_OFF = ['design', 'doctor', 'plugin-authoring'];

export function agentSkills(agentHome = config.agentHome): string[] {
  let own: string[] = [];
  try {
    own = readdirSync(join(agentHome, '.claude', 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    // no agent home skills: only the catalog
  }
  return [...new Set([...own.sort(), CATALOG_SKILL_NAME])];
}

/** The base set of built-in tools (SDK `tools`). */
export const AGENT_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TodoWrite', 'WebFetch', 'WebSearch', 'ToolSearch'];

export function buildAgentOptions(workspace: string, resume: string | undefined, mcpServers: Record<string, McpServerConfig>): Options {
  return {
    cwd: workspace,
    ...(resume ? { resume } : {}),
    // Faster than the login's default (Opus at high effort); AGENT_MODEL / AGENT_EFFORT in .env, 'opus' + 'high' for research.
    model: config.agentModel,
    effort: config.agentEffort,
    mcpServers,
    // The default loads the backend user's ~/.claude settings and skills; 'project' = the
    // workspace and additionalDirectories only.
    settingSources: ['project'],
    additionalDirectories: [config.agentHome],
    // only the app's skills (a filter on the listing and the Skill tool; bundled ones are off below)
    skills: agentSkills(),
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    // The built-in tools the agent needs (plan asdf10k/docs/plans/agent-window-fixes-2026-10-22.md, 2h):
    // files, shell, search, skills, the task list (TaskCreate / TaskUpdate with CLAUDE_CODE_ENABLE_TODO_TOOLS,
    // TodoWrite on older CLIs), web lookups, and ToolSearch for deferred MCP tools. The asdf10k tools
    // (mcp__asdf10k__*) come from mcpServers. Everything else (notebooks, subagents, plan mode,
    // worktrees, cron, ...) is off.
    tools: AGENT_TOOLS,
    // Would fall through to a permission prompt even in bypass mode (a question card is a later feature).
    disallowedTools: ['AskUserQuestion'],
    includePartialMessages: true,
    maxTurns: 150,
    // Without these, the logged-in account's claude.ai connectors are attached to every session.
    strictMcpConfig: true,
    // ... and Claude Code's bundled skills (update-config, loop, schedule, simplify ...) to every listing
    // (three built-in ones survive both the `skills` list and disableBundledSkills: off by name)
    settings: { disableClaudeAiConnectors: true, disableBundledSkills: true, skillOverrides: Object.fromEntries(BUILTIN_SKILLS_OFF.map((n) => [n, 'off' as const])) },
    // + the dataset's description when the app sent one (dataDescription.ts)
    systemPrompt: { type: 'preset', preset: 'claude_code', append: SYSTEM_PROMPT_APPEND + renderDataDescription(readDataDescription(workspace)) },
    env: {
      ...(process.env as Record<string, string>),
      PATH: `${config.pythonBin}:${process.env.PATH ?? ''}`,
      // Task tools are off by default on current models; auto memory loads regardless of settingSources.
      CLAUDE_CODE_ENABLE_TODO_TOOLS: '1',
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1'
    }
  };
}
