import { createFxTerminal, supportsJspi } from 'libfx/browser';
import { chromeTabs, ext } from './ext.ts';
import { errorText, type RuntimeState } from './protocol.ts';
import { getApiKey } from './settings.ts';
import {
  createConfigStore,
  createOAuthSessionStore,
  createPromptHistoryStore,
  createSessionStore,
} from './stores.ts';

const HISTORY_LIMIT = 250_000;
const WASM_TIMEOUT_MS = 60_000;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

export interface HostTerminal {
  cols: number;
  rows: number;
  history: string;
  seq: number;
  write: (bytes: string | Uint8Array) => void;
  feed: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  onData: (callback: (data: string) => void) => () => void;
  onResize: (callback: () => void) => () => void;
}

export function createHostTerminal(): HostTerminal {
  const decoder = new TextDecoder();
  const dataListeners = new Set<(data: string) => void>();
  const resizeListeners = new Set<() => void>();
  const terminal: HostTerminal = {
    cols: 88,
    rows: 28,
    history: '',
    seq: 0,
    write(bytes) {
      const text = typeof bytes === 'string' ? bytes : decoder.decode(bytes);
      terminal.history = `${terminal.history}${text}`.slice(-HISTORY_LIMIT);
      terminal.seq += 1;
      for (const listener of outputListeners) listener(text, terminal.seq);
    },
    feed(data) {
      for (const listener of dataListeners) listener(data);
    },
    resize(cols, rows) {
      terminal.cols = cols;
      terminal.rows = rows;
      for (const listener of resizeListeners) listener();
    },
    onData(callback) {
      dataListeners.add(callback);
      return () => dataListeners.delete(callback);
    },
    onResize(callback) {
      resizeListeners.add(callback);
      return () => resizeListeners.delete(callback);
    },
  };
  return terminal;
}

const outputListeners = new Set<(data: string, seq: number) => void>();

export function onTerminalOutput(listener: (data: string, seq: number) => void): () => void {
  outputListeners.add(listener);
  return () => outputListeners.delete(listener);
}

export async function startFxRuntime(
  terminal: HostTerminal,
  onState?: (state: RuntimeState) => void,
) {
  const state: RuntimeState = {
    status: 'starting',
    jspi: supportsJspi(),
    message: 'checking JSPI',
  };
  const publish = () => onState?.({ ...state });
  publish();

  if (!state.jspi) {
    state.status = 'unsupported';
    state.message = 'fx WASM needs Chrome or Edge 137+ with JSPI.';
    publish();
    return { state, runtime: null };
  }

  try {
    const sessionStore = createSessionStore();
    const sessions = await sessionStore.list();

    state.message = 'loading workspace';
    publish();
    const { createWorkspace } = await import('./workspace.ts');
    const workspace = createWorkspace();

    state.message = 'loading fx-term.wasm';
    publish();
    terminal.write('\r\nloading fx-term.wasm…\r\n');
    const wasm = await loadFxTermWasm();

    state.message = 'instantiating fx';
    publish();
    const apiKey = await getApiKey();
    const runtime = await withTimeout(
      createFxTerminal({
        wasm,
        terminal,
        args: sessions.length > 0 ? ['--resume', 'last'] : [],
        env: {
          HOME: '/home/visitor',
          FX_MODEL: DEFAULT_MODEL,
          ...(apiKey ? { AI_GATEWAY_API_KEY: apiKey } : {}),
        },
        configStore: createConfigStore(),
        sessionStore,
        oauthSessionStore: createOAuthSessionStore(),
        promptHistoryStore: createPromptHistoryStore(),
        workspace,
        async openUrl(url: string) {
          try {
            const tab = await chromeTabs.create({ url, active: true });
            return Boolean(tab.id);
          } catch {
            return false;
          }
        },
      }),
      WASM_TIMEOUT_MS,
      'fx WASM instantiate timed out after 60s',
    );
    state.status = 'ready';
    state.message = undefined;
    publish();
    return { state, runtime };
  } catch (error) {
    state.status = 'error';
    state.message = errorText(error);
    publish();
    return { state, runtime: null };
  }
}

async function loadFxTermWasm() {
  const url = ext.runtime.getURL('/wasm/fx-term.wasm');
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fx-term.wasm missing (${response.status}). Run pnpm wasm and reload the extension.`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (
    bytes.byteLength < 8
    || bytes[0] !== 0x00
    || bytes[1] !== 0x61
    || bytes[2] !== 0x73
    || bytes[3] !== 0x6d
  ) {
    throw new Error('fx-term.wasm is not a valid WebAssembly module.');
  }
  return bytes;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
