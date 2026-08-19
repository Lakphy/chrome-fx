import { ext } from '@/lib/ext.ts';
import { FX_HOST_PORT } from '@/lib/fx-ports.ts';
import type { ExtensionMessage, RuntimeState } from '@/lib/protocol.ts';
import { errorText, isExtensionMessage } from '@/lib/protocol.ts';
import { createHostTerminal, onTerminalOutput, startFxRuntime } from '@/lib/fx-host.ts';

const terminal = createHostTerminal();
let runtime: Awaited<ReturnType<typeof startFxRuntime>>['runtime'] = null;
let state: RuntimeState = { status: 'starting', jspi: false, message: 'host booting' };
let bootGeneration = 0;
let reconnectDelay = 250;
let reconnectTimer = 0;
let port = connect();

function connect() {
  const next = ext.runtime.connect({ name: FX_HOST_PORT });
  next.onMessage.addListener((message) => {
    reconnectDelay = 250;
    onHostMessage(message);
  });
  next.onDisconnect.addListener(() => {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 4000);
      port = connect();
    }, reconnectDelay);
  });
  return next;
}

function publish(message: ExtensionMessage) {
  try {
    port.postMessage(message);
  } catch {
    // onDisconnect reconnects; drop this frame if the service worker is gone.
  }
}

function publishState() {
  publish({ type: 'runtime:state', state });
}

function onHostMessage(message: unknown) {
  if (!isExtensionMessage(message)) return;

  if (message.type === 'term:hello') {
    publish({
      type: 'term:snapshot',
      data: terminal.history,
      seq: terminal.seq,
      state,
    });
    return;
  }

  if (message.type === 'term:in') {
    terminal.feed(message.data);
    return;
  }

  if (message.type === 'term:resize') {
    terminal.resize(message.cols, message.rows);
    try {
      runtime?.resize();
    } catch {
      // Runtime may be mid-restart.
    }
    return;
  }

  if (message.type === 'runtime:restart') {
    void boot();
  }
}

async function boot() {
  const generation = ++bootGeneration;
  try {
    runtime?.abort();
  } catch {
    // Previous runtime may already be dead.
  }
  runtime = null;
  terminal.history = '';
  terminal.seq = 0;
  state = { status: 'starting', jspi: false, message: 'host booting' };
  publishState();
  publish({ type: 'term:snapshot', data: '', seq: 0, state });

  const started = await startFxRuntime(terminal, (next) => {
    if (generation !== bootGeneration) return;
    state = { ...next };
    publishState();
  });

  if (generation !== bootGeneration) {
    try {
      started.runtime?.abort();
    } catch {
      // Superseded boot.
    }
    return;
  }

  runtime = started.runtime;
  state = started.state;
  publishState();
  void runtime?.exited
    .then((code) => {
      if (generation !== bootGeneration) return;
      state = { status: 'stopped', jspi: state.jspi, message: `fx exited with code ${code}` };
      publishState();
    })
    .catch((error) => {
      if (generation !== bootGeneration) return;
      state = { status: 'error', jspi: state.jspi, message: errorText(error) };
      publishState();
    });
}

onTerminalOutput((data, seq) => {
  publish({ type: 'term:out', data, seq });
});

try {
  new Worker(ext.runtime.getURL('/offscreen-keepalive.js'));
} catch {
  // Keepalive is best-effort; the UI port also reopens the host.
}

void boot();
