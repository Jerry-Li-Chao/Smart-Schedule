/** What the Electron preload exposes. Absent in the browser / phone build. */
export interface DeskAPI {
  platform: string;
  load(): Promise<string | null>;
  save(json: string): Promise<void>;
  post(url: string, body: string): Promise<{ status: number; text: string; error?: string }>;
  capture(text: string): void;
  onCapture(cb: (text: string) => void): void;
  hideCapture(): void;
  pinCapture(pin: boolean): void;
  pushInbox(items: { id: string; title: string }[]): void;
  onInbox(cb: (items: { id: string; title: string }[]) => void): void;
  setBadge(n: number): void;
  setShortcut(accelerator: string): Promise<boolean>;
  openBackups(): void;
  writeBackup(name: string, json: string): Promise<string>;
  listBackups(): Promise<{ name: string; size: number; mtime: number }[]>;
  readBackup(name: string): Promise<string>;
  onMenu(cb: (cmd: string) => void): void;
  openCapture(): void;
  llm(method: 'GET' | 'POST', url: string, body?: string): Promise<{ status: number; text: string }>;
  llmStream(id: string, url: string, body: string, onChunk: (text: string) => void): Promise<{ status: number; text: string }>;
  llmAbort(id: string): void;
}

interface GoogleScriptRun {
  withSuccessHandler(fn: (r: string) => void): GoogleScriptRun;
  withFailureHandler(fn: (e: Error) => void): GoogleScriptRun;
  api(payload: string): void;
}

declare global {
  interface Window {
    desk?: DeskAPI;
    google?: { script?: { run: GoogleScriptRun } };
  }
}

export const desk: DeskAPI | undefined = window.desk;
export const isCaptureWindow = location.hash === '#capture';
/** True when the page is being served by the Apps Script web app (phone UI). */
export const inAppsScript = () => !!window.google?.script?.run;
