// Pure post-processing of model output (no app state — unit-tested).

export type Confidence = 'high' | 'medium' | 'low';
const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const lower = (a: Confidence, b: Confidence) => (RANK[a] <= RANK[b] ? a : b);

/** Questions whose true answer drifts over time — a model with a training cutoff can't be sure of these. */
const TIMELY_Q =
  /\b(latest|newest|current(ly)?|now|today|this (week|month|year)|recent|still|fee|fees|price|cost|how much|rate|processing|wait time|how long|deadline|due|open|hours|schedule|law|rule|policy|requirement|eligible|news|20\d\d)\b|最新|现在|目前|多少钱|费用|价格|要钱|多久|截止|政策|规定/i;
/** The answer itself admits it may be stale or unsure. */
const HEDGED_A = /may (be|have) (out of date|changed?)|might have changed|verify|check (the|with|a|your)|not sure|uncertain|i (can't|cannot) know|depends on|可能已|请核实|建议.*确认|不确定/i;

/**
 * Split off the model's "Confidence: x" line (wherever it ended up), then sanity-check it:
 * small models rate almost everything "high", so time-sensitive questions are capped at medium
 * and answers that hedge themselves are capped at low.
 */
export function splitConfidence(text: string, question = ''): { answer: string; confidence?: Confidence } {
  const re = /\s*(?:confidence|置信度|信心)\s*[:：]\s*(high|medium|low|高|中|低)\b\.?/gi;
  const map: Record<string, Confidence> = { 高: 'high', 中: 'medium', 低: 'low' };
  let said: Confidence | undefined;
  for (const m of text.matchAll(re)) said = map[m[1]] ?? (m[1].toLowerCase() as Confidence);
  let answer = text.replace(re, '');
  // drop trailing footnotes models add after the confidence line ("*Note: …*")
  answer = answer.replace(/\n+\s*\*?note:[\s\S]*$/i, '').trim();
  if (!said) return { answer };
  let confidence = said;
  if (TIMELY_Q.test(question)) confidence = lower(confidence, 'medium');
  if (HEDGED_A.test(answer)) confidence = lower(confidence, TIMELY_Q.test(question) ? 'low' : 'medium');
  return { answer, confidence };
}

/** Strip reasoning blocks and markdown noise small models like to add. */
export function clean(text: string) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<\/?think>/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s*[*•]\s+/gm, '- ')
    .replace(/^#+\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

