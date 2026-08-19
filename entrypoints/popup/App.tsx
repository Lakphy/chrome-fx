import { useEffect, useState } from 'react';
import { canInjectIntoUrl } from '@/lib/open-overlay.ts';
import { getApiKey, setApiKey } from '@/lib/settings.ts';

export default function App() {
  const [error, setError] = useState('');
  const [apiKey, setApiKeyDraft] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getApiKey().then(setApiKeyDraft).catch((cause) => {
      setError(cause instanceof Error ? cause.message : '无法读取 API key');
    });
  }, []);

  async function saveKey() {
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      await setApiKey(apiKey.trim());
      await browser.runtime.sendMessage({ type: 'runtime:restart' });
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存 API key');
    } finally {
      setSaving(false);
    }
  }

  async function openPanel() {
    setError('');
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) {
      setError('没有可用的标签页');
      return;
    }
    if (!canInjectIntoUrl(tab.url)) {
      setError('这个页面不能嵌面板（chrome://、扩展商店等）。请打开一个普通网页。');
      return;
    }
    try {
      await browser.runtime.sendMessage({ type: 'overlay:open', tabId: tab.id });
      window.close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法在页面内打开面板');
    }
  }

  return (
    <main className="popup">
      <h1>chrome-fx</h1>
      <p>
        Talk to the fx WASM agent on any page. Chrome/Edge 137+ required. Paste a Vercel AI
        Gateway key here, or run /login in the terminal.
      </p>
      {error ? <p className="error">{error}</p> : null}
      <label className="field">
        <span>API key</span>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Vercel AI Gateway key"
          value={apiKey}
          onChange={(event) => {
            setApiKeyDraft(event.target.value);
            setSaved(false);
          }}
        />
      </label>
      <button type="button" onClick={() => void saveKey()} disabled={saving}>
        {saved ? 'saved' : saving ? 'saving…' : 'save key'}
      </button>
      <button type="button" className="primary" onClick={() => void openPanel()}>
        open on this page
      </button>
    </main>
  );
}
