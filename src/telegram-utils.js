export function isTelegramInviteUrl(value) {
  return /^https?:\/\/(?:www\.)?t\.me\/(?:\+[A-Za-z0-9_-]+|joinchat\/[A-Za-z0-9_-]+)(?:[?#].*)?$/i.test(
    String(value || '').trim(),
  );
}

export function telegramPostRef(value) {
  const match = String(value || '')
    .trim()
    .match(/^https?:\/\/(?:www\.)?t\.me\/([A-Za-z0-9_]{3,})\/(\d+)(?:[?#].*)?$/i);
  return match ? { chat: '@' + match[1], messageId: Number(match[2]) } : null;
}

export function normalizeTelegramUsername(value) {
  const username = String(value || '')
    .trim()
    .replace(/^@/, '');
  return username && !/^-?\d+$/.test(username) ? username : '';
}

export function memberCountKind(type) {
  const normalized = String(type || '').toLowerCase();
  if (normalized === 'channel') return 'subscribers';
  if (['group', 'supergroup'].includes(normalized)) return 'members';
  return 'unknown';
}

export function supportCategory(type) {
  if (type === 'private') return 'private';
  if (type === 'channel') return 'channel';
  if (['group', 'supergroup'].includes(type)) return 'group';
  return '';
}
