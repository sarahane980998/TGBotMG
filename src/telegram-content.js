const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export function toTelegramHtml(value) {
  const source = String(value ?? '');
  const anchorPattern = /<a\s+href\s*=\s*(?:"([^"]*)"|'([^']*)')\s*>([\s\S]*?)<\/a\s*>/gi;
  let html = '';
  let cursor = 0;

  for (const match of source.matchAll(anchorPattern)) {
    const rawHref = (match[1] ?? match[2] ?? '').replace(/&amp;/gi, '&').trim();
    let url;
    try {
      url = new URL(rawHref);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
    } catch {
      continue;
    }

    html += escapeHtml(source.slice(cursor, match.index));
    html += `<a href="${escapeHtml(url.href)}">${escapeHtml(match[3])}</a>`;
    cursor = match.index + match[0].length;
  }

  return html + escapeHtml(source.slice(cursor));
}
