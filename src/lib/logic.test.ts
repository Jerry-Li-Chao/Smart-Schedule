import { describe, expect, it } from 'vitest';
import { parseQuick, splitCapture, extractTime } from './parse';
import { occursOn, nextOccurrence, describeRecurrence } from './recurrence';
import { effectiveLevel } from './priority';
import { classifyColor, legacyToTasks, parseHeaderDates } from './importLegacy';
import type { Task } from '../types';

const TODAY = '2026-10-01'; // a Thursday

describe('parseQuick', () => {
  const p = (s: string) => parseQuick(s, TODAY);

  it('leaves plain notes alone', () => {
    expect(p('Find Keys')).toEqual({ title: 'Find Keys' });
    expect(p('Buy a phone charger (check it fits)').date).toBeUndefined();
    expect(p('Vitamin D 42').title).toBe('Vitamin D 42');
    expect(p('Spanish L2').date).toBeUndefined();
    expect(p('500 points expire soon').date).toBeUndefined();
    expect(p('I sat down with Sun Li').date).toBeUndefined();
  });

  it('understands relative days and times', () => {
    const r = p('Set up a meeting with Alex tmr 9AM. (ask first on Slack)');
    expect(r.date).toBe('2026-10-02');
    expect(r.time).toBe('09:00');
    expect(r.title).toBe('Set up a meeting with Alex. (ask first on Slack)');
    expect(p('call the bank 7:55AM')).toEqual({ title: 'call the bank', time: '07:55', date: TODAY });
    expect(p('Hello!').title).toBe('Hello!');
  });

  it('handles long horizons', () => {
    expect(p('passport renewal in 6 months').date).toBe('2027-04-01');
    expect(p('passport renewal in 6 months').title).toBe('passport renewal');
    expect(p('renew license in two weeks').date).toBe('2026-10-15');
    expect(p('dentist 10/15').date).toBe('2026-10-15');
    expect(p('tax stuff on 3/1').date).toBe('2027-03-01');
    expect(p('flight Dec 20').date).toBe('2026-12-20');
  });

  it('handles weekdays', () => {
    expect(p('gym friday').date).toBe('2026-10-02');
    expect(p('gym on mon').date).toBe('2026-10-05');
    expect(p('review next tue').date).toBe('2026-10-06');
    expect(p('laundry this weekend').date).toBe('2026-10-03');
    expect(p('plan next week').date).toBe('2026-10-05');
  });

  it('handles recurrence', () => {
    expect(p('pay rent every month').recurrence).toEqual({ freq: 'monthly', interval: 1 });
    const c = p('pay credit card every 25th');
    expect(c.recurrence?.freq).toBe('monthly');
    expect(c.date).toBe('2026-10-25');
    expect(c.title).toBe('pay credit card');
    const g = p('gym every mon, wed and fri');
    expect(g.recurrence).toEqual({ freq: 'weekly', interval: 1, byWeekday: [1, 3, 5] });
    expect(g.title).toBe('gym');
    expect(g.date).toBe('2026-10-02'); // Fri is the soonest of Mon/Wed/Fri
    expect(p('standup every weekday 9:30am').recurrence?.byWeekday).toEqual([1, 2, 3, 4, 5]);
    expect(p('water plants every 3 days').recurrence).toEqual({ freq: 'daily', interval: 3 });
  });

  it('handles Chinese', () => {
    expect(p('明天下午3点 看牙医')).toMatchObject({ date: '2026-10-02', time: '15:00', title: '看牙医' });
    expect(p('后天 交房租').date).toBe('2026-10-03');
    expect(p('每周一 健身').recurrence).toEqual({ freq: 'weekly', interval: 1, byWeekday: [1] });
    expect(p('每周一 健身').date).toBe('2026-10-05');
    expect(p('下周三 交报告').date).toBe('2026-10-07');
    expect(p('9AM 晨会').time).toBe('09:00');
    expect(p('9AM 晨会').date).toBe(TODAY);
    expect(p('3个月后 体检').date).toBe('2027-01-01');
  });


  it('"by" sets a deadline', () => {
    expect(p('submit report by 10/10')).toMatchObject({ date: '2026-10-10', deadline: '2026-10-10', title: 'submit report' });
  });
});

describe('monthly day phrases', () => {
  const p = (s: string) => parseQuick(s, TODAY);
  it('reads "every month on the 1st"', () => {
    expect(p('Pay rent every month on the 1st')).toMatchObject({ title: 'Pay rent', date: '2026-10-01', recurrence: { freq: 'monthly', interval: 1 } });
    expect(p('Pay credit card monthly on the 25th')).toMatchObject({ title: 'Pay credit card', date: '2026-10-25' });
    expect(p('Read the 2nd chapter')).toMatchObject({ title: 'Read the 2nd chapter' });
    expect(p('Status report every 6 months until 10/30/27')).toMatchObject({ title: 'Status report', recurrence: { freq: 'monthly', interval: 6, until: '2027-10-30' } });
    expect(p('Vitamin D every day until dec 31')).toMatchObject({ title: 'Vitamin D', date: TODAY, recurrence: { freq: 'daily', until: '2026-12-31' } });
  });
});

describe('all-day events', () => {
  const p = (s: string) => parseQuick(s, TODAY);
  it('reads "all day" and "for N days"', () => {
    expect(p('Thanksgiving nov 26 all day')).toMatchObject({ title: 'Thanksgiving', date: '2026-11-26', allDay: true });
    expect(p('Vacation oct 10 for 4 days')).toMatchObject({ title: 'Vacation', date: '2026-10-10', allDay: true, days: 4 });
  });
});

describe('splitCapture', () => {
  it('splits a pasted numbered sticky, folding sub-bullets into notes', () => {
    const text = `1. Set up a meeting with Alex tmr 9AM.
2. 买一个新台灯
9. Goals this week:
- Finish the slides
- Review the budget
10. Develop a plan`;
    const items = splitCapture(text);
    expect(items).toHaveLength(4);
    expect(items[2]).toEqual({ line: '9. Goals this week:', notes: '- Finish the slides\n- Review the budget' });
    expect(parseQuick(items[0].line, TODAY).title).toBe('Set up a meeting with Alex.');
  });
});

describe('recurrence', () => {
  it('weekly with interval', () => {
    const r = { freq: 'weekly' as const, interval: 2, byWeekday: [1] };
    expect(occursOn(r, '2026-10-05', '2026-10-05')).toBe(true);
    expect(occursOn(r, '2026-10-05', '2026-10-12')).toBe(false);
    expect(occursOn(r, '2026-10-05', '2026-10-19')).toBe(true);
  });
  it('monthly on the 31st clamps to month end', () => {
    const r = { freq: 'monthly' as const, interval: 1 };
    expect(occursOn(r, '2026-01-31', '2026-02-28')).toBe(true);
    expect(occursOn(r, '2026-01-31', '2026-04-30')).toBe(true);
    expect(nextOccurrence(r, '2026-01-31', '2026-10-01')).toBe('2026-10-31');
  });
  it('until', () => {
    expect(occursOn({ freq: 'daily', interval: 1, until: '2026-10-03' }, '2026-10-01', '2026-10-04')).toBe(false);
  });
  it('describes', () => {
    expect(describeRecurrence({ freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] }, TODAY)).toBe('Every weekday');
    expect(describeRecurrence({ freq: 'monthly', interval: 1 }, '2026-10-25')).toBe('Every month on the 25th');
  });
});

describe('priority', () => {
  const base: Task = { type: 'task', id: 't', title: 'x', date: TODAY, importance: 'could', status: 'open', order: 0, createdAt: 0, updatedAt: 0 };
  it('a deadline escalates the colour', () => {
    expect(effectiveLevel({ ...base, deadline: '2026-10-02' }, TODAY)).toEqual({ level: 'must', reason: 'due tomorrow' });
    expect(effectiveLevel({ ...base, deadline: '2026-10-04' }, TODAY).level).toBe('should');
    expect(effectiveLevel({ ...base, deadline: '2026-10-20' }, TODAY).level).toBe('could');
  });
});

describe('legacy import', () => {
  it('classifies the sheet colours', () => {
    expect(classifyColor('#ff0000')).toEqual({ importance: 'must', status: 'open' });
    expect(classifyColor('#ffff00')).toEqual({ importance: 'should', status: 'open' });
    expect(classifyColor('#00ff00')).toEqual({ importance: 'could', status: 'done' });
    expect(classifyColor('#b7b7b7')).toEqual({ importance: 'could', status: 'dropped' });
    expect(classifyColor('#d9d9d9')?.status).toBe('dropped');
    expect(classifyColor('#ffffff')).toEqual({ importance: 'could', status: 'open' });
    expect(classifyColor('#e6b8f9')).toEqual({ importance: 'could', status: 'open' }); // purple class blocks
  });

  it('infers years across Dec → Jan', () => {
    expect(parseHeaderDates(['', '12/31', '1/1'], '2026 Planner', 2026)).toEqual([null, '2026-12-31', '2027-01-01']);
  });

  it('converts columns and merges (cont.) carry-overs', () => {
    const sheet = {
      name: '2026 Planner',
      header: ['9/28', '9/29', '9/30', '10/1'],
      cells: [
        ['9AM 晨会', '9AM Team Meeting', 'Pay day (cont.)', '7:55AM Call the bank'],
        ['Update password', '', 'Reply to landlord', ''],
        ['Pay day', '', '', '问Mia 保险设置'],
      ],
      bgs: [
        ['#00ff00', '#00ff00', '#00ff00', '#ff0000'],
        ['#ff0000', '#ffffff', '#ff0000', '#ffffff'],
        ['#ffff00', '#ffffff', '#ffffff', '#ffff00'],
      ],
    };
    const out = legacyToTasks(sheet, { from: '2026-09-01', today: TODAY, oldUnfinished: 'keep', existing: new Set() });
    const byTitle = Object.fromEntries(out.map((t) => [t.title, t]));
    expect(byTitle['晨会']).toMatchObject({ time: '09:00', status: 'done', date: '2026-09-28' });
    expect(byTitle['Call the bank']).toMatchObject({ time: '07:55', importance: 'must', status: 'open', date: TODAY });
    expect(byTitle['Pay day']).toMatchObject({ date: '2026-09-30', firstScheduled: '2026-09-28', status: 'done' });
    expect(out.filter((t) => t.title === 'Pay day')).toHaveLength(1);
    expect(byTitle['Update password']).toMatchObject({ status: 'open', date: '2026-09-28', stay: true }); // left as is, on its own day
    expect(byTitle['Call the bank'].stay).toBeUndefined(); // today's tasks behave normally
    expect(byTitle['Reply to landlord']).toMatchObject({ importance: 'must', status: 'open' });

    const strict = legacyToTasks(sheet, { from: '2026-09-01', today: TODAY, oldUnfinished: 'obsolete', existing: new Set() });
    expect(strict.find((t) => t.title === 'Update password')?.status).toBe('dropped');
    // re-import is a no-op
    const again = legacyToTasks(sheet, { from: '2026-09-01', today: TODAY, oldUnfinished: 'keep', existing: new Set(out.map((t) => t.id)) });
    expect(again).toHaveLength(0);
  });

  it('extractTime only strips a leading time', () => {
    expect(extractTime('12:15PM Dentist checkup')).toEqual({ title: 'Dentist checkup', time: '12:15' });
    expect(extractTime('Read a chapter')).toEqual({ title: 'Read a chapter' });
  });
});

import { clean, splitConfidence } from './llmText';
describe('LLM answer post-processing', () => {
  it('strips stray think tags and footnotes, reads confidence anywhere', () => {
    const raw = clean('insurance renews yearly via your county.\n\nConfidence: high\n</think>');
    expect(splitConfidence(raw, 'how do I renew insurance?')).toEqual({ answer: 'insurance renews yearly via your county.', confidence: 'high' });
    expect(splitConfidence('Fix posture first.\n\nConfidence: medium\n*Note: see a doctor.*').answer).toBe('Fix posture first.');
    expect(splitConfidence('免费覆盖流感疫苗。Confidence: medium', '要钱吗？')).toEqual({ answer: '免费覆盖流感疫苗。', confidence: 'medium' });
  });
  it('does not trust "high" on time-sensitive questions', () => {
    expect(splitConfidence('iPhone 16. This may be out of date.\nConfidence: high', 'what is the latest iPhone?').confidence).toBe('low');
    expect(splitConfidence('$470.\nConfidence: high', 'how much is my passport renewal fee?').confidence).toBe('medium');
    expect(splitConfidence('About 4.23 US cups.\nConfidence: high', 'how many cups in a liter?').confidence).toBe('high');
  });
});

import { buildDayIndex, itemsFor } from './dayIndex';
describe('day sort modes', () => {
  const mk = (id: string, o: Partial<Task>): Task => ({ type: 'task', id, title: id, date: TODAY, importance: 'could', status: 'open', order: 0, createdAt: 0, updatedAt: 0, ...o });
  const idx = buildDayIndex({
    a: mk('a', { order: 1, importance: 'could', time: '15:00' }),
    b: mk('b', { order: 2, importance: 'must' }),
    c: mk('c', { order: 3, importance: 'should', time: '09:00' }),
    d: mk('d', { order: 4, importance: 'must', status: 'done' }),
    e: mk('e', { order: 5, importance: 'must', time: '08:00' }),
  });
  const ids = (mode: Parameters<typeof itemsFor>[2]) => itemsFor(idx, TODAY, mode, TODAY).map((i) => (i as { task: Task }).task.id).join('');
  it('orders each mode as described', () => {
    expect(ids('manual')).toBe('abcde');
    expect(ids('time')).toBe('ecabd');
    expect(ids('importance')).toBe('becad');
    expect(ids('importance-time')).toBe('ebcad');
  });
});

import { numberedTitle } from './recurrence';
describe('numbered repeats', () => {
  const base: Task = {
    type: 'task', id: 'n', title: 'Spanish L#', date: '2026-09-28', importance: 'could', status: 'open', order: 0, createdAt: 0, updatedAt: 1,
    recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 3, 5] }, numbering: { start: 1 },
  };
  it('counts lessons on Mon/Wed/Fri', () => {
    expect(numberedTitle(base, '2026-09-28')).toBe('Spanish L1');
    expect(numberedTitle(base, '2026-09-30')).toBe('Spanish L2');
    expect(numberedTitle(base, '2026-10-02')).toBe('Spanish L3');
    expect(numberedTitle(base, '2026-10-05')).toBe('Spanish L4');
  });
  it('deleted days give up their number; moved and skipped keep theirs', () => {
    expect(numberedTitle({ ...base, updatedAt: 2, completions: { '2026-09-30': 'deleted' } }, '2026-10-02')).toBe('Spanish L2');
    expect(numberedTitle({ ...base, updatedAt: 3, completions: { '2026-09-30': 'moved' } }, '2026-10-02')).toBe('Spanish L3');
    expect(numberedTitle({ ...base, updatedAt: 4, completions: { '2026-09-30': 'dropped' } }, '2026-10-02')).toBe('Spanish L3');
  });
  it('daily medication from day 42, number appended when there is no #', () => {
    const vit: Task = { ...base, id: 'p', title: 'Vitamin D', recurrence: { freq: 'daily', interval: 1 }, numbering: { start: 42 }, date: '2026-10-01' };
    expect(numberedTitle(vit, '2026-10-01')).toBe('Vitamin D 42');
    expect(numberedTitle(vit, '2026-10-31')).toBe('Vitamin D 72');
  });
});
