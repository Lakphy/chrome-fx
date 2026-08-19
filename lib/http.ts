import { errorText } from './protocol.ts';

const FETCH_TIMEOUT_MS = 20_000;
const FETCH_MAX_BYTES = 2_000_000;

export async function limitedFetch(url: string): Promise<{ text: string; status: number; ok: boolean }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`invalid url: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('only http(s) urls are allowed');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(parsed.href, { redirect: 'follow', signal: controller.signal });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > FETCH_MAX_BYTES) {
      throw new Error(`response too large (${bytes.byteLength} bytes, max ${FETCH_MAX_BYTES})`);
    }
    return {
      text: new TextDecoder().decode(bytes),
      status: response.status,
      ok: response.ok,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`fetch timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
    }
    throw new Error(errorText(error));
  } finally {
    clearTimeout(timer);
  }
}
