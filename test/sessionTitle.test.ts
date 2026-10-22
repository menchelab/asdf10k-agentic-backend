import { describe, expect, it } from 'vitest';
import { isGeneratedTitle, titleFromMessage } from '../src/sessions/SessionManager.js';

describe('session title from the first message', () => {
  it('recognises the generated "<dataset> <stamp>" title only', () => {
    expect(isGeneratedTitle('ppicml 2026-10-22 09:41', 'ppicml')).toBe(true);
    expect(isGeneratedTitle('ppicml hubs of the selection', 'ppicml')).toBe(false);
    expect(isGeneratedTitle('other 2026-10-22 09:41', 'ppicml')).toBe(false);
    expect(isGeneratedTitle('Continue: report on MYH7', 'ppicml')).toBe(false);
  });

  it('first line, whitespace collapsed, at most 60 characters cut at a word', () => {
    expect(titleFromMessage('\n  What are the   hubs?\nand more')).toBe('What are the hubs?');
    const long = 'Which proteins in my selection bridge the metabolite layer and the transcript layer most often';
    const t = titleFromMessage(long);
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t).toBe('Which proteins in my selection bridge the metabolite layer…');
    expect(titleFromMessage('   ')).toBe('');
  });
});
