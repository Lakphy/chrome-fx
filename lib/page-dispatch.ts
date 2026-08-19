export interface PageResult {
  ok: boolean;
  error?: string;
  value?: string;
  selector?: string;
}

export interface SnapshotResult {
  text: string;
  html: string;
  a11y: string;
}

export type PageOp =
  | 'snapshot'
  | 'click'
  | 'type'
  | 'press'
  | 'hover'
  | 'focus'
  | 'scroll'
  | 'wait'
  | 'eval'
  | 'select'
  | 'attr'
  | 'text'
  | 'html';

export type PageWorld = 'ISOLATED' | 'MAIN';

export function pageDispatch(op: PageOp, args: unknown[]): unknown {
  try {
    return dispatch(op, args);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function dispatch(op: PageOp, args: unknown[]): unknown {
  const find = (selector: string): Element | null => {
    try {
      if (selector.startsWith('text=')) {
        const needle = selector.slice(5);
        const iter = document.evaluate(
          `//*[contains(normalize-space(.), ${JSON.stringify(needle)})]`,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null,
        );
        return (iter.singleNodeValue as Element | null) ?? null;
      }
      if (selector.startsWith('//') || selector.startsWith('(//')) {
        const iter = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        return (iter.singleNodeValue as Element | null) ?? null;
      }
      return document.querySelector(selector);
    } catch (error) {
      throw new Error(`invalid selector: ${selector}${error instanceof Error ? ` (${error.message})` : ''}`);
    }
  };
  const describe = (el: Element): string => {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className
      ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
      : '';
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };
  const missing = (selector: string): PageResult => ({ ok: false, error: `not found: ${selector}` });
  const selector = String(args[0] ?? '');

  if (op === 'snapshot') {
    const clip = (value: string, limit: number) =>
      value.length > limit ? `${value.slice(0, limit)}\n...[truncated]\n` : value;
    const interesting = new Set(['a', 'button', 'input', 'textarea', 'select', 'h1', 'h2', 'h3', 'h4', 'img', 'label', 'summary']);
    const lines: string[] = [];
    const walk = (el: Element, depth: number) => {
      if (lines.length >= 500) return;
      const tag = el.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'noscript') return;
      const role = el.getAttribute('role') || tag;
      const name = (el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('placeholder') || (el as HTMLElement).innerText || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 90);
      if (interesting.has(tag) || el.getAttribute('role') || depth <= 1) {
        const id = el.id ? `#${el.id}` : '';
        lines.push(`${'  '.repeat(depth)}${role}${id} ${name}`.trimEnd());
      }
      for (const child of Array.from(el.children)) walk(child, depth + 1);
    };
    if (document.body) walk(document.body, 0);
    return {
      text: clip(document.body?.innerText ?? '', 80_000),
      html: clip(document.documentElement?.outerHTML ?? '', 150_000),
      a11y: clip(lines.join('\n'), 40_000),
    };
  }

  if (op === 'scroll') {
    const where = String(args[0] ?? 'down');
    if (where === 'top') window.scrollTo(0, 0);
    else if (where === 'bottom') window.scrollTo(0, document.documentElement.scrollHeight);
    else if (where === 'up') window.scrollBy(0, -window.innerHeight * 0.8);
    else if (where === 'down') window.scrollBy(0, window.innerHeight * 0.8);
    else if (/^-?\d+$/.test(where)) window.scrollTo(0, Number(where));
    return { x: window.scrollX, y: window.scrollY };
  }

  if (op === 'press') {
    const keyCombo = String(args[0] ?? '');
    const parts = keyCombo.split('+');
    const key = parts[parts.length - 1] ?? '';
    const event = new KeyboardEvent('keydown', {
      key,
      ctrlKey: parts.includes('Ctrl') || parts.includes('Control'),
      metaKey: parts.includes('Meta') || parts.includes('Cmd'),
      altKey: parts.includes('Alt'),
      shiftKey: parts.includes('Shift'),
      bubbles: true,
    });
    (document.activeElement ?? document.body).dispatchEvent(event);
    return { ok: true, value: keyCombo };
  }

  if (op === 'eval') {
    try {
      const value = (0, eval)(String(args[0] ?? ''));
      if (value === undefined) return { ok: true, value: 'undefined' };
      if (typeof value === 'string') return { ok: true, value };
      return { ok: true, value: JSON.stringify(value, null, 2) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  if (op === 'wait') {
    const timeoutMs = Math.min(60_000, Math.max(1, Number(args[1] ?? 5000) || 5000));
    const found = find(selector);
    if (found) return Promise.resolve({ ok: true, selector: describe(found) });
    return new Promise((resolve) => {
      let timer = 0;
      let observer: MutationObserver | undefined;
      const finish = (result: PageResult) => {
        window.clearTimeout(timer);
        observer?.disconnect();
        resolve(result);
      };
      timer = window.setTimeout(() => {
        finish({ ok: false, error: `timeout waiting for ${selector}` });
      }, timeoutMs);
      observer = new MutationObserver(() => {
        try {
          const el = find(selector);
          if (el) finish({ ok: true, selector: describe(el) });
        } catch (error) {
          finish({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  const el = find(selector);
  if (!el) return missing(selector);
  if (op === 'click') {
    (el as HTMLElement).click();
    return { ok: true, selector: describe(el) };
  }
  if (op === 'type') {
    const text = String(args[1] ?? '');
    (el as HTMLElement).focus();
    if ('value' in el) {
      const proto = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
      proto?.set?.call(el, text);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      el.textContent = text;
    }
    return { ok: true, selector: describe(el), value: text };
  }
  if (op === 'hover') {
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    return { ok: true, selector: describe(el) };
  }
  if (op === 'focus') {
    (el as HTMLElement).focus();
    return { ok: true, selector: describe(el) };
  }
  if (op === 'select') {
    (el as HTMLSelectElement).value = String(args[1] ?? '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, selector: describe(el), value: String(args[1] ?? '') };
  }
  if (op === 'attr') return { ok: true, value: el.getAttribute(String(args[1] ?? '')) ?? '', selector: describe(el) };
  if (op === 'text') return { ok: true, value: (el as HTMLElement).innerText, selector: describe(el) };
  if (op === 'html') return { ok: true, value: el.outerHTML, selector: describe(el) };
  return { ok: false, error: `unknown page op: ${op}` };
}
