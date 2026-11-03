export function normalizeImageLinkButton(value, hasPhoto) {
  if (value == null || value === false || value === '') return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('图片跳转按钮设置无效。');
  }
  if (!hasPhoto) throw new Error('请先上传图片或填写图片来源，再添加图片跳转按钮。');

  const text = String(value.text || '').trim();
  const rawUrl = String(value.url || '').trim();
  if (!text) throw new Error('请填写图片下方按钮文字。');
  if (text.length > 64) throw new Error('按钮文字不能超过 64 个字符。');
  if (!rawUrl || rawUrl.length > 1000) throw new Error('请填写有效的跳转链接（最多 1000 个字符）。');

  let url;
  try { url = new URL(rawUrl); } catch { throw new Error('跳转链接格式无效，请填写完整的 http:// 或 https:// 地址。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('跳转链接仅支持安全的 http:// 或 https:// 地址。');
  }
  return { text, url: url.href };
}

export function buildPublicationReplyMarkup(templateMarkup, imageLinkButton, includeEmpty = false) {
  const rows = Array.isArray(templateMarkup?.inline_keyboard)
    ? templateMarkup.inline_keyboard.filter(Array.isArray).map(row => row.map(button => ({ ...button })))
    : [];
  if (imageLinkButton) rows.push([{ text: imageLinkButton.text, url: imageLinkButton.url }]);
  if (!rows.length) return includeEmpty ? { inline_keyboard: [] } : null;
  return { inline_keyboard: rows };
}
