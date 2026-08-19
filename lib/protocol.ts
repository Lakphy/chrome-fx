export type RuntimeStatus = 'starting' | 'ready' | 'unsupported' | 'error' | 'stopped';

export interface RuntimeState {
  status: RuntimeStatus;
  message?: string;
  jspi: boolean;
}

export const CHROME_TAB_METHODS = [
  'query',
  'get',
  'update',
  'create',
  'remove',
  'goForward',
  'goBack',
  'reload',
  'captureVisibleTab',
] as const;

export const CHROME_COOKIE_METHODS = ['getAll'] as const;

export const PAGE_OPS = [
  'snapshot',
  'click',
  'type',
  'press',
  'hover',
  'focus',
  'scroll',
  'wait',
  'eval',
  'select',
  'attr',
  'text',
  'html',
] as const;

export type ChromeTabMethod = (typeof CHROME_TAB_METHODS)[number];
export type ChromeCookieMethod = (typeof CHROME_COOKIE_METHODS)[number];
export type PageOpName = (typeof PAGE_OPS)[number];

export type ExtensionMessage =
  | { type: 'controller:claim'; tabId?: number }
  | { type: 'overlay:open'; tabId?: number }
  | { type: 'overlay:toggle' }
  | { type: 'runtime:status' }
  | { type: 'runtime:restart' }
  | { type: 'term:hello' }
  | { type: 'term:in'; data: string }
  | { type: 'term:resize'; cols: number; rows: number }
  | { type: 'term:out'; data: string; seq: number }
  | { type: 'term:snapshot'; data: string; seq: number; state?: RuntimeState }
  | { type: 'runtime:state'; state: RuntimeState }
  | {
    type: 'storage:call';
    area: 'local' | 'session';
    method: 'get' | 'set' | 'remove';
    args: unknown[];
  }
  | {
    type: 'chrome:call';
    namespace: 'tabs' | 'cookies';
    method: string;
    args: unknown[];
  }
  | {
    type: 'page:run';
    tabId: number;
    op: string;
    args: unknown[];
    world: 'ISOLATED' | 'MAIN';
  };

const STATUSES = new Set<string>(['starting', 'ready', 'unsupported', 'error', 'stopped']);
const TAB_METHODS = new Set<string>(CHROME_TAB_METHODS);
const COOKIE_METHODS = new Set<string>(CHROME_COOKIE_METHODS);
const PAGE_OP_SET = new Set<string>(PAGE_OPS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function isTabId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isSeq(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isTermSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1000;
}

export function isRuntimeState(value: unknown): value is RuntimeState {
  if (!isRecord(value) || !STATUSES.has(String(value.status)) || typeof value.jspi !== 'boolean') {
    return false;
  }
  return value.message === undefined || typeof value.message === 'string';
}

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;

  switch (value.type) {
    case 'overlay:toggle':
    case 'runtime:status':
    case 'runtime:restart':
    case 'term:hello':
      return true;
    case 'controller:claim':
    case 'overlay:open':
      return value.tabId === undefined || isTabId(value.tabId);
    case 'term:in':
      return typeof value.data === 'string';
    case 'term:resize':
      return isTermSize(value.cols) && isTermSize(value.rows);
    case 'term:out':
      return typeof value.data === 'string' && isSeq(value.seq);
    case 'term:snapshot':
      return (
        typeof value.data === 'string'
        && isSeq(value.seq)
        && (value.state === undefined || isRuntimeState(value.state))
      );
    case 'runtime:state':
      return isRuntimeState(value.state);
    case 'storage:call':
      return (
        (value.area === 'local' || value.area === 'session')
        && (value.method === 'get' || value.method === 'set' || value.method === 'remove')
        && Array.isArray(value.args)
      );
    case 'chrome:call':
      if (!Array.isArray(value.args) || typeof value.method !== 'string') return false;
      if (value.namespace === 'tabs') return TAB_METHODS.has(value.method);
      if (value.namespace === 'cookies') return COOKIE_METHODS.has(value.method);
      return false;
    case 'page:run':
      return (
        isTabId(value.tabId)
        && PAGE_OP_SET.has(String(value.op))
        && Array.isArray(value.args)
        && (value.world === 'ISOLATED' || value.world === 'MAIN')
      );
    default:
      return false;
  }
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
