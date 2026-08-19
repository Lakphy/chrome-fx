import { setControllerTabId } from './settings.ts';

const blocked = /^(chrome|chrome-extension|edge|about|devtools|view-source):/i;
const webStore = /^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)\b/i;

export function canInjectIntoUrl(url: string | undefined): boolean {
  if (!url) return false;
  return !blocked.test(url) && !webStore.test(url);
}

function markOpen() {
  window.sessionStorage.setItem('chrome-friend-open', '1');
  window.dispatchEvent(new Event('chrome-friend-open'));
}

export async function openOverlayInTab(tabId: number): Promise<void> {
  const tab = await browser.tabs.get(tabId);
  if (!canInjectIntoUrl(tab.url)) {
    throw new Error('这个页面不能嵌面板（chrome://、扩展商店等）。请打开一个普通网页。');
  }
  await setControllerTabId(tabId);

  await browser.scripting.executeScript({
    target: { tabId },
    func: markOpen,
  });

  try {
    await browser.tabs.sendMessage(tabId, { type: 'overlay:open' });
    return;
  } catch {
    // The tab was opened before the extension loaded.
  }

  await browser.scripting.executeScript({
    target: { tabId },
    files: ['/content-scripts/overlay.js'],
  });

  await browser.tabs.sendMessage(tabId, { type: 'overlay:open' }).catch(() => undefined);
}
