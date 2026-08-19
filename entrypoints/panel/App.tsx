import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { RotateCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { FX_UI_PORT } from '@/lib/fx-ports.ts';
import type { RuntimeState } from '@/lib/protocol.ts';
import { isExtensionMessage } from '@/lib/protocol.ts';

export default function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const portRef = useRef<ReturnType<typeof browser.runtime.connect> | null>(null);
  const appliedSeq = useRef(0);
  const [state, setState] = useState<RuntimeState>({
    status: 'starting',
    jspi: false,
    message: 'connecting',
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: {
        background: '#171717',
        foreground: '#fafafa',
        cursor: '#fafafa',
        cursorAccent: '#171717',
        selectionBackground: '#262626',
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    try {
      fit.fit();
    } catch {
      // Host can be 0×0 on first paint.
    }
    termRef.current = terminal;

    let alive = true;
    let reconnectTimer = 0;

    const applySnapshot = (data: string, seq: number) => {
      try {
        terminal.reset();
        if (data) terminal.write(data);
      } catch {
        // Terminal may be mid-dispose.
      }
      appliedSeq.current = seq;
    };

    const onPortMessage = (message: unknown) => {
      if (!isExtensionMessage(message)) return;
      if (message.type === 'term:out' && message.seq > appliedSeq.current) {
        appliedSeq.current = message.seq;
        terminal.write(message.data);
      }
      if (message.type === 'term:snapshot') {
        applySnapshot(message.data, message.seq);
        if (message.state) setState(message.state);
      }
      if (message.type === 'runtime:state') setState(message.state);
    };

    const send = (message: { type: string; [key: string]: unknown }) => {
      try {
        portRef.current?.postMessage(message);
      } catch {
        // Reconnect will resend hello.
      }
    };

    const sendResize = () => {
      send({ type: 'term:resize', cols: terminal.cols, rows: terminal.rows });
    };

    const attachPort = () => {
      if (!alive) return;
      const port = browser.runtime.connect({ name: FX_UI_PORT });
      portRef.current = port;
      port.onMessage.addListener(onPortMessage);
      port.onDisconnect.addListener(() => {
        if (portRef.current === port) portRef.current = null;
        if (!alive) return;
        reconnectTimer = window.setTimeout(attachPort, 250);
      });
      send({ type: 'term:hello' });
      sendResize();
    };

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
        sendResize();
      } catch {
        // Host can be 0×0 while the popover is settling.
      }
    });
    observer.observe(host);

    const onData = terminal.onData((data) => {
      send({ type: 'term:in', data });
    });

    attachPort();
    terminal.focus();

    return () => {
      alive = false;
      window.clearTimeout(reconnectTimer);
      observer.disconnect();
      onData.dispose();
      portRef.current?.disconnect();
      portRef.current = null;
      terminal.dispose();
      termRef.current = null;
    };
  }, []);

  return (
    <div className="shell">
      <header className="bar">
        <div className="brand">
          <span className="mark">FX</span>
          {state.status !== 'ready' ? (
            <span className="status" data-state={state.status}>
              {statusLabel(state)}
            </span>
          ) : null}
        </div>
        <div className="actions">
          <button
            type="button"
            className="icon-btn"
            title="Restart"
            aria-label="Restart"
            onClick={() => {
              try {
                portRef.current?.postMessage({ type: 'runtime:restart' });
              } catch {
                void browser.runtime.sendMessage({ type: 'runtime:restart' });
              }
            }}
          >
            <RotateCw size={14} strokeWidth={2} />
          </button>
        </div>
      </header>
      {state.status === 'unsupported' || state.status === 'error' ? (
        <p className="banner">{state.message}</p>
      ) : null}
      <div className="term" ref={hostRef} />
    </div>
  );
}

function statusLabel(state: RuntimeState): string {
  if (state.status === 'starting') return state.message ?? 'starting';
  if (state.status === 'unsupported') return 'needs Chrome 137+';
  if (state.status === 'stopped') return 'stopped';
  return state.message ? `error: ${state.message}` : 'error';
}
