import codeGs from '../../apps-script/Code.gs?raw';

/** The script version this app ships with (read from the bundled Code.gs — one source of truth). */
export const BUNDLED_SCRIPT_VERSION = Number(/var SCRIPT_VERSION = (\d+)/.exec(codeGs)?.[1] ?? 0);

/** What each script version adds — shown when the deployed one is older. */
export const SCRIPT_CHANGES: Record<number, string[]> = {
  2: [
    'All-day and multi-day events appear on every day they cover in the Google Sheet',
    'Repeating tasks show their running number (L1, L2, L3…) and moved tasks are marked “(cont.)”',
    'Keeping an imported tab linked, so the app’s changes are written back into it',
    'Tells the app which version it is, so you get this reminder next time',
  ],
  3: ['Tasks you gave a colour show that colour in the Google Sheet while they’re open'],
  4: ['Importing reads cells merged across several days, so they come in as multi-day events'],
};

/** Changes the deployed script is missing (empty when it's up to date or not connected yet). */
export function missingChanges(deployed: number | undefined): string[] {
  if (deployed === undefined || deployed >= BUNDLED_SCRIPT_VERSION) return [];
  const out: string[] = [];
  for (let v = deployed + 1; v <= BUNDLED_SCRIPT_VERSION; v++) out.push(...(SCRIPT_CHANGES[v] ?? []));
  return out;
}
