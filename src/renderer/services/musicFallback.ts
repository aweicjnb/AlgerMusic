import axios from 'axios';

// A missing build variable must never become a relative file:// request.
export function createMusicFallbackClient(endpoint: unknown) {
  let baseURL: string | undefined;
  if (typeof endpoint === 'string') {
    try {
      const url = new URL(endpoint.trim());
      if (['https:', 'http:'].includes(url.protocol) && !url.search && !url.hash) {
        baseURL = url.href.replace(/\/+$/, '');
      }
    } catch {
      // Optional service is unconfigured (including placeholder values).
    }
  }
  const client = baseURL ? axios.create({ baseURL, timeout: 10000 }) : undefined;
  return {
    configured: Boolean(client),
    async getMusic<T>(id: number) {
      if (!client) return null;
      return client.get<T>('/music', { params: { id } });
    }
  };
}
