import { FX_HOST_PORT, FX_UI_PORT } from '@/lib/fx-ports.ts';
import { openOverlayInTab } from '@/lib/open-overlay.ts';
import type { PageOp, PageWorld } from '@/lib/page-dispatch.ts';
import { assertPageDispatchInjectable, pageDispatch } from '@/lib/page-dispatch.ts';
import type { ExtensionMessage, RuntimeState } from '@/lib/protocol.ts';
import { errorText, isExtensionMessage } from '@/lib/protocol.ts';
import { setControllerTabId } from '@/lib/settings.ts';

const starting: RuntimeState = { status: 'starting', jspi: false, message: 'waiting for host' };

type RuntimePort = ReturnType<typeof browser.runtime.connect>;

let hostPort: RuntimePort | null = null;
let creatingOffscreen: Promise<void> | null = null;
let pendingRestart = false;
const uiPorts = new Set<RuntimePort>();
let lastState: RuntimeState = starting;
let lastSnapshot = { data: '', seq: 0 };

function send(port: RuntimePort, message: ExtensionMessage) {
  try {
    port.postMessage(message);
  } catch {
    // Port closed between broadcast and send.
  }
}

function broadcast(message: ExtensionMessage) {
  if (message.type === 'runtime:state') lastState = message.state;
  if (message.type === 'term:snapshot') {
    lastSnapshot = { data: message.data, seq: message.seq };
    if (message.state) lastState = message.state;
  }
  if (message.type === 'term:out') {
    lastSnapshot = {
      data: `${lastSnapshot.data}${message.data}`.slice(-250_000),
      seq: message.seq,
    };
  }
  for (const port of uiPorts) send(port, message);
}

function sendToHost(message: ExtensionMessage) {
  if (hostPort) {
    send(hostPort, message);
    return true;
  }
  return false;
}

function markHostError(error: unknown) {
  lastState = {
    status: 'error',
    jspi: lastState.jspi,
    message: errorText(error),
  };
  broadcast({ type: 'runtime:state', state: lastState });
}

function beginRestart() {
  lastSnapshot = { data: '', seq: 0 };
  lastState = { ...starting, message: 'restarting' };
  broadcast({ type: 'runtime:state', state: lastState });
  broadcast({ type: 'term:snapshot', data: '', seq: 0, state: lastState });
  if (!sendToHost({ type: 'runtime:restart' })) pendingRestart = true;
}

async function ensureOffscreen() {
  if (!browser.offscreen) {
    markHostError('This browser has no offscreen API.');
    return;
  }
  if (await browser.offscreen.hasDocument()) return;
  if (creatingOffscreen) {
    await creatingOffscreen;
    if (!(await browser.offscreen.hasDocument())) {
      markHostError('Offscreen host did not come up.');
    }
    return;
  }
  lastState = { ...starting, message: 'opening host' };
  broadcast({ type: 'runtime:state', state: lastState });
  creatingOffscreen = (async () => {
    try {
      await browser.offscreen.createDocument({
        url: '/offscreen.html',
        reasons: ['WORKERS', 'BLOBS'],
        justification: 'Run the fx WebAssembly agent',
      });
    } catch (error) {
      const text = errorText(error);
      if (!/already exists|Only a single offscreen/i.test(text)) {
        throw error;
      }
    }
  })();
  try {
    await creatingOffscreen;
  } catch (error) {
    markHostError(error);
  } finally {
    creatingOffscreen = null;
  }
}

function attachHost(port: RuntimePort) {
  hostPort = port;
  port.onMessage.addListener((message) => {
    if (isExtensionMessage(message)) broadcast(message);
  });
  port.onDisconnect.addListener(() => {
    if (hostPort === port) hostPort = null;
    if (lastState.status === 'ready' || lastState.status === 'starting') {
      lastState = { ...starting, message: 'host disconnected' };
      broadcast({ type: 'runtime:state', state: lastState });
    }
    void ensureOffscreen();
  });
  if (pendingRestart) {
    pendingRestart = false;
    send(port, { type: 'runtime:restart' });
  }
}

function attachUi(port: RuntimePort) {
  uiPorts.add(port);
  void ensureOffscreen();
  send(port, { type: 'runtime:state', state: lastState });
  send(port, {
    type: 'term:snapshot',
    data: lastSnapshot.data,
    seq: lastSnapshot.seq,
    state: lastState,
  });
  port.onMessage.addListener((message) => {
    if (!isExtensionMessage(message)) return;
    void ensureOffscreen();
    if (message.type === 'term:hello') {
      send(port, {
        type: 'term:snapshot',
        data: lastSnapshot.data,
        seq: lastSnapshot.seq,
        state: lastState,
      });
      return;
    }
    if (message.type === 'runtime:restart') {
      beginRestart();
      return;
    }
    sendToHost(message);
  });
  port.onDisconnect.addListener(() => {
    uiPorts.delete(port);
  });
}

function handleMessage(message: ExtensionMessage, sender: Browser.runtime.MessageSender) {
  if (message.type === 'controller:claim') {
    const tabId = message.tabId ?? sender.tab?.id;
    if (tabId !== undefined) void setControllerTabId(tabId);
    void ensureOffscreen();
    return;
  }

  if (message.type === 'overlay:open') {
    return (async () => {
      const tabId = message.tabId ?? sender.tab?.id;
      if (tabId === undefined) throw new Error('没有可用的标签页');
      void ensureOffscreen();
      await openOverlayInTab(tabId);
      return { ok: true };
    })();
  }

  if (message.type === 'storage:call') {
    const area = browser.storage[message.area];
    if (!area) return Promise.reject(new Error(`storage.${message.area} is unavailable`));
    if (message.method === 'get') return area.get(message.args[0] as string | string[] | Record<string, unknown>);
    if (message.method === 'set') return area.set(message.args[0] as Record<string, unknown>);
    return area.remove(message.args[0] as string | string[]);
  }

  if (message.type === 'chrome:call') {
    const namespace = browser[message.namespace] as unknown as Record<string, ((...values: unknown[]) => Promise<unknown>) | undefined>;
    const method = namespace?.[message.method];
    if (typeof method !== 'function') {
      return Promise.reject(new Error(`${message.namespace}.${message.method} is unavailable`));
    }
    return Promise.resolve(method(...message.args)).catch((error) => {
      throw new Error(errorText(error));
    });
  }

  if (message.type === 'page:run') {
    return (async () => {
      const [injection] = await browser.scripting.executeScript({
        target: { tabId: message.tabId },
        func: pageDispatch,
        args: [message.op as PageOp, message.args],
        world: message.world as PageWorld,
      });
      if (!injection) throw new Error('script injection returned no frame');
      return injection.result;
    })().catch((error) => {
      throw new Error(errorText(error));
    });
  }

  if (message.type === 'term:hello') {
    void ensureOffscreen();
    return Promise.resolve({
      type: 'term:snapshot' as const,
      data: lastSnapshot.data,
      seq: lastSnapshot.seq,
      state: lastState,
    });
  }

  if (message.type === 'runtime:restart') {
    void ensureOffscreen();
    beginRestart();
  }
}

export default defineBackground(() => {
  try {
    assertPageDispatchInjectable();
  } catch (error) {
    console.error(error);
  }
  void ensureOffscreen();
  browser.runtime.onStartup.addListener(() => {
    void ensureOffscreen();
  });
  browser.runtime.onInstalled.addListener(() => {
    void ensureOffscreen();
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === FX_HOST_PORT) {
      attachHost(port);
      return;
    }
    if (port.name === FX_UI_PORT) attachUi(port);
  });

  browser.runtime.onMessage.addListener((message, sender) => {
    if (!isExtensionMessage(message)) return;
    try {
      return handleMessage(message, sender);
    } catch (error) {
      return Promise.reject(new Error(errorText(error)));
    }
  });
});
