/**
 * The dataset's description for the agent (`data/<dataset>/data_description.txt` in the app,
 * written by the dataset's authors): the app sends it with a message when it changed, the session
 * keeps it as `input/data_description.txt`, and every agent start appends it to the system prompt
 * (agentOptions.ts). An empty text = the dataset has none (the file is removed).
 */
import { existsSync, readFileSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const FILE = join('input', 'data_description.txt');

export async function writeDataDescription(workspace: string, text: string): Promise<void> {
  const file = join(workspace, FILE);
  if (text.trim()) await writeFile(file, text);
  else await rm(file, { force: true });
}

/** Sync: read once per agent start while the options are built. */
export function readDataDescription(workspace: string): string | null {
  const file = join(workspace, FILE);
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8').trim();
  return text || null;
}

/** The system prompt section; '' without a description. */
export function renderDataDescription(text: string | null): string {
  if (!text) return '';
  return `

The dataset's authors describe the open dataset for you below (also in ${FILE}). It is background knowledge about the data: what it is, how it was built, what its columns mean, and how to talk to its users. Follow its guidance; the <app_context> of each message stays the source for the current state of the app.
<dataset_description>
${text}
</dataset_description>`;
}
