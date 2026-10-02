export function uid(prefix: string) {
  const rand = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}_${Date.now().toString(36)}${rand[0].toString(36)}${rand[1].toString(36).slice(0, 4)}`;
}

/** Deterministic id so importing the same sheet twice doesn't create duplicates. */
export function hashId(prefix: string, input: string) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return `${prefix}_${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

export const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');
