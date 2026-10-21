import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDataDescription, renderDataDescription, writeDataDescription } from '../src/agent/dataDescription.js';
import { buildAgentOptions } from '../src/agent/agentOptions.js';

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ws-'));
  mkdirSync(join(dir, 'input'));
  return dir;
}

describe('data description', () => {
  it('is stored, read back and removed with an empty text', async () => {
    const ws = workspace();
    expect(readDataDescription(ws)).toBeNull();
    await writeDataDescription(ws, '# HA network\nseeds = disease genes\n');
    expect(readDataDescription(ws)).toBe('# HA network\nseeds = disease genes');
    await writeDataDescription(ws, '  ');
    expect(existsSync(join(ws, 'input', 'data_description.txt'))).toBe(false);
  });

  it('renders nothing without a text', () => {
    expect(renderDataDescription(null)).toBe('');
  });

  it('ends up in the system prompt of the session agent', async () => {
    const ws = workspace();
    const before = buildAgentOptions(ws, undefined, {}).systemPrompt as { append: string };
    expect(before.append).not.toContain('<dataset_description>');
    await writeDataDescription(ws, 'multiCore genes of one disease group');
    const after = buildAgentOptions(ws, undefined, {}).systemPrompt as { append: string };
    expect(after.append).toContain('<dataset_description>\nmultiCore genes of one disease group\n</dataset_description>');
  });
});
