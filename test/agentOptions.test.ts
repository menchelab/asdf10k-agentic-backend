import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentSkills, BUILTIN_SKILLS_OFF, buildAgentOptions } from '../src/agent/agentOptions.js';
import { CATALOG_SKILL_NAME } from '../src/agent/catalogSkill.js';
import { SYSTEM_PROMPT_APPEND } from '../src/agent/systemPrompt.js';

/** Finding N4: the session sees only the app's skills, never the host user's or Claude Code's own. */
describe('agent skill sources', () => {
  it('skills = agent-home/.claude/skills + the generated catalog skill', () => {
    const home = mkdtempSync(join(tmpdir(), 'agent-home-'));
    for (const name of ['b-skill', 'a-skill']) mkdirSync(join(home, '.claude', 'skills', name), { recursive: true });
    writeFileSync(join(home, '.claude', 'skills', 'not-a-dir.md'), 'x');
    expect(agentSkills(home)).toEqual(['a-skill', 'b-skill', CATALOG_SKILL_NAME]);
    expect(agentSkills(join(home, 'missing'))).toEqual([CATALOG_SKILL_NAME]);
  });

  it('the options: project settings only, the explicit list, bundled and built-in skills off', () => {
    const o = buildAgentOptions('/tmp/ws', undefined, {});
    expect(o.settingSources).toEqual(['project']);
    expect(o.skills).toEqual(expect.arrayContaining(['asdf10k-app', 'asdf10k-columns', 'asdf10k-reports', CATALOG_SKILL_NAME]));
    expect(o.skills).toHaveLength(4);
    const settings = o.settings as { disableBundledSkills?: boolean; skillOverrides?: Record<string, string> };
    expect(settings.disableBundledSkills).toBe(true);
    for (const n of BUILTIN_SKILLS_OFF) expect(settings.skillOverrides?.[n]).toBe('off');
  });
});

describe('system prompt (N5)', () => {
  it('names the desktop fallback of xr.molecule.open: a structure3d card with config.node', () => {
    expect(SYSTEM_PROMPT_APPEND).toContain('{"type":"window","window":"structure3d","config":{"node":"MYH7"}}');
    expect(SYSTEM_PROMPT_APPEND).toMatch(/xr\.molecule\.open[^.]*no AR user or no session, offer the desktop window/);
  });
});
