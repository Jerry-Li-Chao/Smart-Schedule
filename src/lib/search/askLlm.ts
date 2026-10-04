import type { ISODate } from '../../types';
import { S } from '../../store';
import { desk } from '../bridge';
import { dayLabel as day, parseSSE, type AskContext } from './ask';

/** The parts of Ask that talk to the local LLM (kept apart from ask.ts so that stays testable). */

export function systemPrompt(today: ISODate) {
  return [
    `You answer questions about the user's own planner. Today is ${day(today)}.`,
    'Use ONLY the numbered items given. Reply in 1–3 short sentences, in the language of the question.',
    'Cite the items you rely on like [2] or [1][4]. Copy dates as written; do not calculate new ones.',
    'If the items do not answer the question, say so plainly in one sentence.',
  ].join('\n');
}

/** Stream an answer; calls onDelta with each new piece of text. Abort with the signal. */
export async function askStream(question: string, ctx: AskContext, today: ISODate, onDelta: (t: string) => void, signal: AbortSignal): Promise<void> {
  const { llmUrl, llmModel } = S().settings;
  const url = llmUrl.replace(/\/+$/, '') + '/chat/completions';
  const body = JSON.stringify({
    model: llmModel,
    stream: true,
    temperature: 0,
    max_tokens: 220,
    reasoning_effort: 'none', // Ollama: no hidden "thinking" before the answer
    messages: [
      { role: 'system', content: systemPrompt(today) },
      { role: 'user', content: `Items:\n${ctx.text || '(nothing relevant found)'}\n\nQuestion: ${question}` },
    ],
  });
  let buf = '';
  const feed = (chunk: string) => {
    if (signal.aborted) return;
    const r = parseSSE(buf + chunk);
    buf = r.rest;
    r.deltas.forEach(onDelta);
  };

  if (desk) {
    const id = Math.random().toString(36).slice(2);
    signal.addEventListener('abort', () => desk!.llmAbort(id));
    const r = await desk.llmStream(id, url, body, feed);
    if (r.status >= 400 && r.status !== 499) throw new Error(`The AI server answered ${r.status}: ${r.text.slice(0, 120)}`);
    feed('\n');
    return;
  }
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal });
  if (!r.ok || !r.body) throw new Error(`The AI server answered ${r.status}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    feed(dec.decode(value, { stream: true }));
  }
  feed('\n');
}

let warmAt = 0;
/** Load the model into memory ahead of time (a cold start takes seconds; a warm answer ~1 s). */
export function warmUp() {
  const { llmEnabled, llmUrl, llmModel } = S().settings;
  if (!llmEnabled || !llmUrl || !llmModel || Date.now() - warmAt < 4 * 60_000) return;
  warmAt = Date.now();
  const url = llmUrl.replace(/\/+$/, '') + '/chat/completions';
  const body = JSON.stringify({ model: llmModel, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] });
  if (desk) void desk.llm('POST', url, body).catch(() => {});
  else void fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
}
