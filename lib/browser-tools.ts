import { chromeCookies, chromeTabs, runPageScript } from './ext.ts';
import { limitedFetch } from './http.ts';
import type { PageOp, PageResult, SnapshotResult } from './page-dispatch.ts';
import { errorText } from './protocol.ts';
import { getControllerTabId, setControllerTabId } from './settings.ts';

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const ok = (stdout: string): CommandResult => ({ stdout, stderr: '', exitCode: 0 });
const fail = (stderr: string, exitCode = 1): CommandResult => ({ stdout: '', stderr, exitCode });

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function resolveTabId(explicit?: number): Promise<number> {
  if (explicit !== undefined) {
    await chromeTabs.get(explicit);
    return explicit;
  }
  const stored = await getControllerTabId();
  if (stored !== undefined) {
    try {
      await chromeTabs.get(stored);
      return stored;
    } catch {
      await setControllerTabId(undefined);
    }
  }
  const [tab] = await chromeTabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('no controllable browser tab');
  return tab.id;
}

async function getTab(tabId?: number) {
  const id = await resolveTabId(tabId);
  return chromeTabs.get(id);
}

function runInTab<T>(
  tabId: number,
  op: PageOp,
  args: unknown[] = [],
  world: 'ISOLATED' | 'MAIN' = 'ISOLATED',
): Promise<T> {
  return runPageScript<T>(tabId, op, args, world);
}

export async function runBrowserCommand(argv: string[]): Promise<CommandResult> {
  const [subcommand = 'help', ...rest] = argv;
  try {
    switch (subcommand) {
      case 'help':
      case '--help':
      case '-h':
        return ok(HELP);
      case 'tabs':
        return ok(json(await listTabs()));
      case 'tab':
        return await focusTab(rest[0]);
      case 'info':
        return ok(json(await tabInfo()));
      case 'navigate':
      case 'open':
        return await navigate(rest.join(' ').trim());
      case 'new':
        return await newTab(rest.join(' ').trim());
      case 'close':
        return await closeTab(rest[0]);
      case 'back':
        return await historyMove(-1);
      case 'forward':
        return await historyMove(1);
      case 'reload':
        return await reload();
      case 'snapshot':
        return await snapshot();
      case 'click':
        return await click(rest.join(' ').trim());
      case 'type':
        return await typeText(rest[0], rest.slice(1).join(' '));
      case 'press':
        return await press(rest.join('+'));
      case 'hover':
        return await hover(rest.join(' ').trim());
      case 'focus':
        return await focus(rest.join(' ').trim());
      case 'scroll':
        return await scroll(rest[0]);
      case 'wait':
        return await waitFor(rest[0], Number(rest[1] ?? 5000));
      case 'eval':
      case 'js':
        return await evaluate(rest.join(' '));
      case 'select':
        return await selectOption(rest[0], rest.slice(1).join(' '));
      case 'attr':
        return await attribute(rest[0], rest[1]);
      case 'text':
        return await readText(rest.join(' ').trim());
      case 'html':
        return await readHtml(rest.join(' ').trim());
      case 'cookies':
        return await cookies();
      case 'screenshot':
        return await screenshot();
      case 'fetch':
        return await fetchUrl(rest);
      default:
        return fail(`unknown browser command: ${subcommand}\n${HELP}`, 2);
    }
  } catch (error) {
    return fail(`${errorText(error)}\n`);
  }
}

async function listTabs() {
  const tabs = await chromeTabs.query({ lastFocusedWindow: true });
  const current = await getControllerTabId();
  return tabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    url: tab.url,
    active: tab.active,
    target: tab.id === current,
  }));
}

async function focusTab(idText: string | undefined) {
  if (!idText) return fail('usage: browser tab <id>\n');
  const tabId = Number(idText);
  if (!Number.isInteger(tabId)) return fail('tab id must be an integer\n');
  await chromeTabs.update(tabId, { active: true });
  await setControllerTabId(tabId);
  return ok(json(await tabInfo(tabId)));
}

async function tabInfo(tabId?: number) {
  const tab = await getTab(tabId);
  return {
    id: tab.id,
    title: tab.title,
    url: tab.url,
    status: tab.status,
    pinned: tab.pinned,
    audible: tab.audible,
  };
}

async function navigate(url: string) {
  if (!url) return fail('usage: browser navigate <url>\n');
  const tab = await getTab();
  const next = normalizeUrl(url);
  await chromeTabs.update(tab.id!, { url: next });
  return ok(`navigating to ${next}\n`);
}

async function newTab(url: string) {
  const tab = await chromeTabs.create({ url: url ? normalizeUrl(url) : 'about:blank', active: true });
  if (tab.id) await setControllerTabId(tab.id);
  return ok(json({ id: tab.id, url: tab.url }));
}

async function closeTab(idText?: string) {
  if (idText !== undefined) {
    const tabId = Number(idText);
    if (!Number.isInteger(tabId) || tabId < 0) return fail('tab id must be an integer\n');
    await chromeTabs.remove(tabId);
    return ok(`closed tab ${tabId}\n`);
  }
  const tabId = await resolveTabId();
  await chromeTabs.remove(tabId);
  return ok(`closed tab ${tabId}\n`);
}

async function historyMove(delta: number) {
  const tab = await getTab();
  if (delta > 0) await chromeTabs.goForward(tab.id!);
  else await chromeTabs.goBack(tab.id!);
  return ok(delta > 0 ? 'forward\n' : 'back\n');
}

async function reload() {
  const tab = await getTab();
  await chromeTabs.reload(tab.id!);
  return ok('reloaded\n');
}

async function snapshot() {
  const tab = await getTab();
  const page = await runInTab<SnapshotResult>(tab.id!, 'snapshot');
  return ok(json({
    tabId: tab.id,
    url: tab.url,
    title: tab.title,
    ...page,
  }));
}

async function pageResult(op: PageOp, args: unknown[], world: 'ISOLATED' | 'MAIN' = 'ISOLATED') {
  const tab = await getTab();
  return runInTab<PageResult>(tab.id!, op, args, world);
}

async function click(selector: string) {
  if (!selector) return fail('usage: browser click <selector>\n');
  const result = await pageResult('click', [selector]);
  return result.ok ? ok(json(result)) : fail(`${result.error}\n`);
}

async function typeText(selector: string | undefined, text: string) {
  if (!selector || !text) return fail('usage: browser type <selector> <text>\n');
  const result = await pageResult('type', [selector, text]);
  return result.ok ? ok(json(result)) : fail(`${result.error}\n`);
}

async function press(key: string) {
  if (!key) return fail('usage: browser press <Key> or Ctrl+Key\n');
  const result = await pageResult('press', [key]);
  return result.ok ? ok(json(result)) : fail(`${result.error}\n`);
}

async function hover(selector: string) {
  if (!selector) return fail('usage: browser hover <selector>\n');
  const result = await pageResult('hover', [selector]);
  return result.ok ? ok(json(result)) : fail(`${result.error}\n`);
}

async function focus(selector: string) {
  if (!selector) return fail('usage: browser focus <selector>\n');
  const result = await pageResult('focus', [selector]);
  return result.ok ? ok(json(result)) : fail(`${result.error}\n`);
}

async function scroll(where: string | undefined) {
  const tab = await getTab();
  const result = await runInTab<{ x: number; y: number }>(tab.id!, 'scroll', [where ?? 'down']);
  return ok(json(result));
}

async function waitFor(selector: string | undefined, timeoutMs: number) {
  if (!selector) return fail('usage: browser wait <selector> [timeoutMs]\n');
  const result = await pageResult('wait', [selector, Number.isFinite(timeoutMs) ? timeoutMs : 5000]);
  return result.ok ? ok(json(result)) : fail(`${result.error}\n`);
}

async function evaluate(code: string) {
  if (!code) return fail('usage: browser eval <javascript>\n');
  const result = await pageResult('eval', [code], 'MAIN');
  return result.ok ? ok(`${result.value}\n`) : fail(`${result.error}\n`);
}

async function selectOption(selector: string | undefined, value: string) {
  if (!selector || !value) return fail('usage: browser select <selector> <value>\n');
  const result = await pageResult('select', [selector, value]);
  return result.ok ? ok(json(result)) : fail(`${result.error}\n`);
}

async function attribute(selector: string | undefined, name: string | undefined) {
  if (!selector || !name) return fail('usage: browser attr <selector> <name>\n');
  const result = await pageResult('attr', [selector, name]);
  return result.ok ? ok(`${result.value ?? ''}\n`) : fail(`${result.error}\n`);
}

async function readText(selector: string) {
  if (!selector) return fail('usage: browser text <selector>\n');
  const result = await pageResult('text', [selector]);
  return result.ok ? ok(`${result.value ?? ''}\n`) : fail(`${result.error}\n`);
}

async function readHtml(selector: string) {
  if (!selector) return fail('usage: browser html <selector>\n');
  const result = await pageResult('html', [selector]);
  return result.ok ? ok(`${result.value ?? ''}\n`) : fail(`${result.error}\n`);
}

async function cookies() {
  const tab = await getTab();
  if (!tab.url) return fail('tab has no url\n');
  const list = await chromeCookies.getAll({ url: tab.url });
  return ok(json(list.map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
  }))));
}

async function screenshot() {
  const tab = await getTab();
  if (tab.windowId === undefined) return fail('tab has no window\n');
  const dataUrl = await chromeTabs.captureVisibleTab(tab.windowId, { format: 'png' });
  return ok(`data url (${dataUrl.length} chars)\n${dataUrl.slice(0, 120)}...\n`);
}

async function fetchUrl(args: string[]) {
  const outputFlag = args.indexOf('-o');
  let output: string | undefined;
  const parts = [...args];
  if (outputFlag >= 0) {
    output = parts[outputFlag + 1];
    parts.splice(outputFlag, 2);
  }
  const url = parts[0];
  if (!url) return fail('usage: browser fetch <url> [-o /workspace/file]\n');
  const response = await limitedFetch(url);
  const preview = response.text.length > 48_000
    ? `${response.text.slice(0, 48_000)}\n...[truncated ${response.text.length} bytes]\n`
    : response.text;
  return {
    stdout: output
      ? `saved ${response.text.length} bytes; use write from the caller\n${JSON.stringify({ output, bytes: response.text.length, preview })}\n`
      : preview,
    stderr: '',
    exitCode: response.ok ? 0 : 1,
  };
}

const BLOCKED_NAV = /^(javascript|data|vbscript|file|blob):/i;

function normalizeUrl(url: string): string {
  const next = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)
    ? url
    : url.startsWith('/')
      ? url
      : `https://${url}`;
  if (BLOCKED_NAV.test(next)) {
    throw new Error(`blocked url scheme: ${next.split(':', 1)[0]}`);
  }
  return next;
}

export async function collectPageFiles(): Promise<Record<string, string>> {
  try {
    const tab = await getTab();
    const page = await runInTab<SnapshotResult>(tab.id!, 'snapshot');
    return {
      '/workspace/page/url.txt': `${tab.url ?? ''}\n`,
      '/workspace/page/title.txt': `${tab.title ?? ''}\n`,
      '/workspace/page/text.txt': page.text,
      '/workspace/page/html.html': page.html,
      '/workspace/page/a11y.md': page.a11y,
      '/workspace/page/meta.json': json({
        id: tab.id,
        url: tab.url,
        title: tab.title,
        status: tab.status,
      }),
      '/workspace/tabs.json': json(await listTabs()),
    };
  } catch (error) {
    const message = errorText(error);
    return {
      '/workspace/page/url.txt': '',
      '/workspace/page/title.txt': '',
      '/workspace/page/text.txt': message,
      '/workspace/page/html.html': '',
      '/workspace/page/a11y.md': message,
      '/workspace/page/meta.json': json({ error: message }),
      '/workspace/tabs.json': json({ error: message }),
    };
  }
}

const HELP = `browser commands (chrome-fx workspace):

  browser tabs
  browser tab <id>
  browser info
  browser navigate <url>
  browser new [url]
  browser close [id]
  browser back | forward | reload
  browser snapshot
  browser click <selector>
  browser type <selector> <text>
  browser press <Key> | Ctrl+Enter
  browser hover <selector>
  browser focus <selector>
  browser scroll up|down|top|bottom|<y>
  browser wait <selector> [timeoutMs]
  browser eval <javascript>
  browser select <selector> <value>
  browser attr <selector> <name>
  browser text <selector>
  browser html <selector>
  browser cookies
  browser screenshot
  browser fetch <url>

Selectors: CSS, #id, text=Visible label, or //xpath.

js <javascript> is an alias for browser eval.
Page files update on read: cat page/text.txt, page/a11y.md, tabs.json.
`;
