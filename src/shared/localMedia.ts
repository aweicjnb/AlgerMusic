// Keep stored local:// URLs intact. Chromium's native file loader handles media seeks.
export function playbackMediaUrl(value: string): string {
  if (!value.startsWith('local://')) return value;
  let raw = value.slice('local://'.length).split(/[?#]/, 1)[0];
  if (/^\/%(?:2f|5c)/i.test(raw)) raw = raw.slice(1);
  let filePath = decodeURIComponent(raw).replace(/\\/g, '/');
  if (/^\/[a-zA-Z]:\//.test(filePath)) filePath = filePath.slice(1);
  const parts = filePath.split('/').map(encodeURIComponent);
  if (/^[a-zA-Z]:\//.test(filePath)) {
    parts[0] = filePath.slice(0, 2);
    return new URL('file:///' + parts.join('/')).href;
  }
  if (filePath.startsWith('//')) return new URL('file:' + parts.join('/')).href;
  if (filePath.startsWith('/')) return new URL('file://' + parts.join('/')).href;
  throw new Error('Local media path must be absolute');
}
