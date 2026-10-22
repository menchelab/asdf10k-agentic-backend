/**
 * SDK options for a session's live query. Every choice here was confirmed in the phase 0 spike
 * (asdf10k/docs/agent-window-plan.md, section 15).
 */

import type { McpServerConfig, Options } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../config.js';
import { SYSTEM_PROMPT_APPEND } from './systemPrompt.js';
import { readDataDescription, renderDataDescription } from './dataDescription.js';

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
    skills: 'all',
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
    settings: { disableClaudeAiConnectors: true },
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
