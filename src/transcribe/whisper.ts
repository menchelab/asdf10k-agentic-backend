/**
 * Speech to text for the Agent window's push-to-talk button: 16 kHz mono WAV in, text out, through
 * whisper.cpp's `whisper-cli` (Metal on Apple Silicon, CUDA on Linux when built so). Model and
 * binary are found from the environment (`WHISPER_CPP_BIN`, `WHISPER_MODEL`, `WHISPER_MODELS_DIR`,
 * `WHISPER_LANG`, `WHISPER_THREADS`); without them the feature reports itself unavailable and the
 * app hides the button. One transcription at a time (the model is loaded per call, ~1 s for
 * large-v3-turbo q8_0 on an M3). README "Voice input".
 */

import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, join, resolve } from 'node:path';

export interface WhisperConfig {
  bin: string | null;
  model: string | null;
  language: string;
  threads: number;
}

export interface Transcription {
  text: string;
  language?: string;
  durationMs: number;
}

const BIN_NAMES = ['whisper-cli', 'whisper-cpp', 'main'];
/** Preferred model files, best first (all ggml-*.bin from whisper.cpp). */
const MODEL_PREFERENCE = ['large-v3-turbo-q8_0', 'large-v3-turbo-q5_0', 'large-v3-turbo', 'large-v3-q5_0', 'medium-q8_0', 'medium', 'small-q8_0', 'small', 'base'];

function findOnPath(names: string[]): string | null {
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const name of names) for (const dir of dirs) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function findModel(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.startsWith('ggml-') && f.endsWith('.bin'));
  if (files.length === 0) return null;
  const rank = (f: string): number => {
    const i = MODEL_PREFERENCE.findIndex((m) => f === `ggml-${m}.bin`);
    return i === -1 ? MODEL_PREFERENCE.length : i;
  };
  files.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return join(dir, files[0]!);
}

/** Resolves binary and model from the environment (paths relative to `root`). */
export function resolveWhisperConfig(env: NodeJS.ProcessEnv, root: string): WhisperConfig {
  const bin = env.WHISPER_CPP_BIN ? resolve(root, env.WHISPER_CPP_BIN) : findOnPath(BIN_NAMES);
  const model = env.WHISPER_MODEL ? resolve(root, env.WHISPER_MODEL) : findModel(resolve(root, env.WHISPER_MODELS_DIR ?? '../asdf10k-agentic-models'));
  return {
    bin: bin && existsSync(bin) ? bin : null,
    model: model && existsSync(model) ? model : null,
    language: env.WHISPER_LANG?.trim() || 'auto',
    threads: Math.max(1, Number(env.WHISPER_THREADS ?? 4) || 4)
  };
}

export class Transcriber {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly config: WhisperConfig) {}

  get available(): boolean {
    return this.config.bin !== null && this.config.model !== null;
  }

  get modelName(): string | null {
    return this.config.model ? basename(this.config.model).replace(/^ggml-/, '').replace(/\.bin$/, '') : null;
  }

  /** Why the feature is off, for the health endpoint and the log. */
  get problem(): string | null {
    if (!this.config.bin) return 'whisper-cli not found (brew install whisper-cpp, or set WHISPER_CPP_BIN)';
    if (!this.config.model) return 'no ggml-*.bin model (download ggml-large-v3-turbo-q8_0.bin into WHISPER_MODELS_DIR, or set WHISPER_MODEL)';
    return null;
  }

  /** Transcribes a 16 kHz mono 16-bit WAV. Calls run one after another. */
  transcribeWav(wav: Buffer): Promise<Transcription> {
    const run = this.queue.then(() => this.runWhisper(wav), () => this.runWhisper(wav));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async runWhisper(wav: Buffer): Promise<Transcription> {
    if (!this.config.bin || !this.config.model) throw new Error(this.problem ?? 'transcription unavailable');
    const started = Date.now();
    const dir = await mkdtemp(join(tmpdir(), 'asdf10k-ptt-'));
    try {
      const input = join(dir, 'in.wav');
      const outBase = join(dir, 'out');
      await writeFile(input, wav);
      const args = ['-m', this.config.model, '-f', input, '-l', this.config.language, '-t', String(this.config.threads), '-nt', '-np', '-oj', '-of', outBase];
      await new Promise<void>((resolveRun, reject) => {
        execFile(this.config.bin!, args, { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }, (err, _stdout, stderr) => {
          if (err) reject(new Error(`whisper-cli failed: ${err.message}${stderr ? `\n${String(stderr).slice(-400)}` : ''}`));
          else resolveRun();
        });
      });
      const json = JSON.parse(await readFile(`${outBase}.json`, 'utf8')) as { result?: { language?: string }; transcription?: Array<{ text?: string }> };
      const text = (json.transcription ?? []).map((s) => s.text ?? '').join(' ').replace(/\s+/g, ' ').trim();
      return { text, ...(json.result?.language ? { language: json.result.language } : {}), durationMs: Date.now() - started };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
