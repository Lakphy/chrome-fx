import type { PageOp, PageWorld } from './page-dispatch.ts';
import { pageDispatch } from './page-dispatch.ts';

type Ext = typeof browser;
type StorageAreaName = 'local' | 'session';
type ChromeNamespace = 'tabs' | 'cookies';

type Globals = typeof globalThis & {
  chrome?: Ext;
  browser?: Ext;
};

function pick(): Ext {
  const { chrome: chromeApi, browser: browserApi } = globalThis as Globals;
  // Chrome 137+ / WXT may expose a partial `browser` with runtime but no tabs.
  // Offscreen documents often have storage but not tabs/scripting.
  if (chromeApi?.tabs?.query) return chromeApi;
  if (browserApi?.tabs?.query) return browserApi;
  if (chromeApi?.storage?.local) return chromeApi;
  if (browserApi?.storage?.local) return browserApi;
  if (chromeApi?.runtime) return chromeApi;
  if (browserApi?.runtime) return browserApi;
  throw new Error('extension APIs are unavailable');
}

export const ext = new Proxy({} as Ext, {
  get(_target, prop) {
    return Reflect.get(pick(), prop);
  },
}) as Ext;

async function storageCall(
  area: StorageAreaName,
  method: 'get' | 'set' | 'remove',
  args: unknown[],
) {
  const direct = ext.storage?.[area];
  if (direct && method in direct) {
    return (direct[method] as (...values: unknown[]) => Promise<unknown>)(...args);
  }
  return ext.runtime.sendMessage({
    type: 'storage:call',
    area,
    method,
    args,
  });
}

export function localGet(key: string) {
  return storageCall('local', 'get', [key]) as Promise<Record<string, unknown>>;
}

export function localSet(items: Record<string, unknown>) {
  return storageCall('local', 'set', [items]) as Promise<void>;
}

export function sessionGet(key: string) {
  return storageCall('session', 'get', [key]) as Promise<Record<string, unknown>>;
}

export function sessionSet(items: Record<string, unknown>) {
  return storageCall('session', 'set', [items]) as Promise<void>;
}

export function sessionRemove(key: string) {
  return storageCall('session', 'remove', [key]) as Promise<void>;
}

function chromeCall(namespace: ChromeNamespace, method: string, ...args: unknown[]) {
  const ns = Reflect.get(pick(), namespace) as unknown as Record<string, ((...values: unknown[]) => unknown) | undefined> | undefined;
  const fn = ns?.[method];
  if (typeof fn === 'function') {
    return Promise.resolve(fn.apply(ns, args));
  }
  return ext.runtime.sendMessage({
    type: 'chrome:call',
    namespace,
    method,
    args,
  });
}

export const chromeTabs = {
  query: (query: Record<string, unknown>) =>
    chromeCall('tabs', 'query', query) as Promise<Browser.tabs.Tab[]>,
  get: (tabId: number) => chromeCall('tabs', 'get', tabId) as Promise<Browser.tabs.Tab>,
  update: (tabId: number, update: Record<string, unknown>) =>
    chromeCall('tabs', 'update', tabId, update) as Promise<Browser.tabs.Tab>,
  create: (create: Record<string, unknown>) =>
    chromeCall('tabs', 'create', create) as Promise<Browser.tabs.Tab>,
  remove: (tabId: number) => chromeCall('tabs', 'remove', tabId) as Promise<void>,
  goForward: (tabId: number) => chromeCall('tabs', 'goForward', tabId) as Promise<void>,
  goBack: (tabId: number) => chromeCall('tabs', 'goBack', tabId) as Promise<void>,
  reload: (tabId: number) => chromeCall('tabs', 'reload', tabId) as Promise<void>,
  captureVisibleTab: (windowId: number, options: Record<string, unknown>) =>
    chromeCall('tabs', 'captureVisibleTab', windowId, options) as Promise<string>,
};

export const chromeCookies = {
  getAll: (details: Record<string, unknown>) =>
    chromeCall('cookies', 'getAll', details) as Promise<Browser.cookies.Cookie[]>,
};

export async function runPageScript<T>(
  tabId: number,
  op: PageOp,
  args: unknown[] = [],
  world: PageWorld = 'ISOLATED',
): Promise<T> {
  const scripting = Reflect.get(pick(), 'scripting') as Ext['scripting'] | undefined;
  if (typeof scripting?.executeScript === 'function') {
    const [injection] = await scripting.executeScript({
      target: { tabId },
      func: pageDispatch,
      args: [op, args],
      world,
    });
    if (!injection) throw new Error('script injection returned no frame');
    return injection.result as T;
  }
  return ext.runtime.sendMessage({
    type: 'page:run',
    tabId,
    op,
    args,
    world,
  }) as Promise<T>;
}
