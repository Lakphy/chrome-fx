import { localGet, localSet, sessionGet, sessionRemove, sessionSet } from './ext.ts';

const SETTINGS_KEY = 'chrome-friend.settings';

export async function getApiKey(): Promise<string> {
  try {
    const stored = await localGet(SETTINGS_KEY);
    const value = stored[SETTINGS_KEY];
    if (value && typeof value === 'object' && 'apiKey' in value) {
      const apiKey = (value as { apiKey?: unknown }).apiKey;
      return typeof apiKey === 'string' ? apiKey : '';
    }
  } catch {
    // Storage may be unavailable in a degraded host.
  }
  return '';
}

export async function setApiKey(apiKey: string): Promise<void> {
  const stored = await localGet(SETTINGS_KEY);
  const previous = stored[SETTINGS_KEY];
  const next = previous && typeof previous === 'object' ? { ...previous, apiKey } : { apiKey };
  await localSet({ [SETTINGS_KEY]: next });
}

export async function getControllerTabId(): Promise<number | undefined> {
  try {
    const stored = await sessionGet('controllerTabId');
    return typeof stored.controllerTabId === 'number' ? stored.controllerTabId : undefined;
  } catch {
    return undefined;
  }
}

export async function setControllerTabId(tabId: number | undefined): Promise<void> {
  if (tabId === undefined) {
    await sessionRemove('controllerTabId');
    return;
  }
  await sessionSet({ controllerTabId: tabId });
}
