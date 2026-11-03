const mediaKeys = ['photo','video','animation','document','audio','voice','video_note','sticker','contact','location'];

export function describeTelegramMessage(message) {
  const body = message || {};
  // Telegram service updates such as pinned_message wrap the actual message
  // inside a child object. Use that child for content/media extraction while
  // keeping the original update in message_json for auditing.
  const nested = body.pinned_message && typeof body.pinned_message === 'object' ? body.pinned_message : body;
  const mediaType = mediaKeys.find(key => nested[key]) || 'text';
  const mediaValue = nested[mediaType];
  const media = Array.isArray(mediaValue) ? mediaValue[mediaValue.length - 1] : mediaValue;
  const text = String(nested.text || nested.caption || '');
  const label = body.pinned_message ? '📌 置顶消息：' : '';
  const preview = label + (text.replace(/\s+/g, ' ').trim() || ({ photo: '[图片]', video: '[视频]', animation: '[动图]', document: '[文件]', audio: '[音频]', voice: '[语音]', video_note: '[视频消息]', sticker: '[贴纸]', contact: '[联系人]', location: '[位置]' }[mediaType] || (body.pinned_message ? '[置顶消息]' : '[消息]')));
  return { text, preview: preview.slice(0, 600), mediaType, mediaFileId: media?.file_id || null, replyToMessageId: nested.reply_to_message?.message_id || body.reply_to_message?.message_id || null, entities: nested.entities || nested.caption_entities || body.entities || body.caption_entities || [] };
}

function participantName(from = {}, chat = {}) {
  const name = [from.first_name || chat.first_name, from.last_name || chat.last_name].filter(Boolean).join(' ').trim();
  return name || (from.username || chat.username ? '@' + (from.username || chat.username) : 'Telegram 用户');
}

export async function recordSupportMessage(pool, input = {}) {
  const message = input.message || {};
  const chat = input.chat || message.chat || {};
  const botId = String(input.botId || '');
  const chatId = String(chat.id ?? input.chatId ?? '');
  const messageId = String(input.messageId ?? message.message_id ?? '');
  const chatType = String(chat.type || input.chatType || 'private');
  if (!botId || !chatId || !messageId || !['private','group','supergroup','channel'].includes(chatType)) return { stored: false };

  const sender = input.sender || message.from || {};
  const details = describeTelegramMessage(message);
  const direction = input.direction === 'outgoing' ? 'outgoing' : 'incoming';
  const title = String(input.title || chat.title || (chatType === 'private' ? participantName(sender, chat) : chat.username ? '@' + chat.username : chatId)).slice(0, 255);
  const username = String(input.username || chat.username || sender.username || '').replace(/^@/, '').slice(0, 160);
  const firstName = String(input.firstName || sender.first_name || chat.first_name || '').slice(0, 160);
  const lastName = String(input.lastName || sender.last_name || chat.last_name || '').slice(0, 160);
  const senderName = String(input.senderName || participantName(sender, chat)).slice(0, 255);
  const senderUsername = String(input.senderUsername || sender.username || '').replace(/^@/, '').slice(0, 160);
  const text = String(input.text ?? details.text);
  const preview = String(input.preview || details.preview).slice(0, 600);
  const mediaType = String(input.mediaType || details.mediaType).slice(0, 24);
  const mediaFileId = input.mediaFileId || details.mediaFileId || null;
  const mediaUrl = String(input.mediaUrl || '').slice(0, 1000) || null;
  const replyTo = input.replyToMessageId ?? details.replyToMessageId;
  const entities = input.entities || details.entities;
  const createdAt = input.createdAt instanceof Date ? input.createdAt : new Date(Number(input.date ?? message.date ?? Date.now() / 1000) * 1000);
  const rawMessage = input.rawMessage || message;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('INSERT IGNORE INTO support_chats(bot_id,chat_id,chat_type,title,username,first_name,last_name) VALUES(?,?,?,?,?,?,?)', [botId, chatId, chatType, title, username || null, firstName || null, lastName || null]);
    const [chatRows] = await connection.query('SELECT last_message_at FROM support_chats WHERE bot_id=? AND chat_id=? FOR UPDATE', [botId, chatId]);
    const [writeResult] = await connection.query('INSERT INTO support_messages(bot_id,chat_id,message_id,direction,sender_id,sender_name,sender_username,text_content,media_type,media_file_id,media_url,reply_to_message_id,entities_json,message_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE direction=VALUES(direction),sender_id=VALUES(sender_id),sender_name=VALUES(sender_name),sender_username=VALUES(sender_username),text_content=VALUES(text_content),media_type=VALUES(media_type),media_file_id=VALUES(media_file_id),media_url=VALUES(media_url),reply_to_message_id=VALUES(reply_to_message_id),entities_json=VALUES(entities_json),message_json=VALUES(message_json),created_at=VALUES(created_at)', [botId, chatId, messageId, direction, sender.id == null ? null : String(sender.id), senderName, senderUsername || null, text, mediaType, mediaFileId, mediaUrl, replyTo == null ? null : String(replyTo), JSON.stringify(entities || []), JSON.stringify(rawMessage || {}), createdAt]);
    const inserted = writeResult.affectedRows === 1;
    const priorDate = chatRows[0]?.last_message_at ? new Date(chatRows[0].last_message_at) : null;
    const latest = !priorDate || createdAt.getTime() >= priorDate.getTime();
    const unreadDelta = inserted && direction === 'incoming' && !input.edited ? 1 : 0;
    await connection.query('UPDATE support_chats SET title=IF(?,?,title),username=IF(?,?,username),first_name=IF(?,?,first_name),last_name=IF(?,?,last_name),unread_count=unread_count+?,last_message_id=IF(?,?,last_message_id),last_message_preview=IF(?,?,last_message_preview),last_direction=IF(?,?,last_direction),last_message_at=IF(?,?,last_message_at),updated_at=CURRENT_TIMESTAMP(3) WHERE bot_id=? AND chat_id=?', [Boolean(title), title, Boolean(username), username || null, Boolean(firstName), firstName || null, Boolean(lastName), lastName || null, unreadDelta, latest, messageId, latest, preview, latest, direction, latest, createdAt, botId, chatId]);
    await connection.commit();
    return { stored: true, inserted, unreadDelta };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function listSupportChats(pool, botIds = [], type = '') {
  if (!botIds.length) return [];
  const placeholders = botIds.map(() => '?').join(',');
  let typeFilter = '';
  const params = [...botIds];
  if (type === 'group') typeFilter = " AND chat_type IN ('group','supergroup')";
  else if (['private', 'channel', 'supergroup'].includes(type)) { typeFilter = ' AND chat_type=?'; params.push(type); }
  const [rows] = await pool.query('SELECT bot_id AS botId,chat_id AS chatId,chat_type AS type,title,username,first_name AS firstName,last_name AS lastName,unread_count AS unreadCount,CAST(last_message_id AS CHAR) AS lastMessageId,last_message_at AS lastMessageAt,last_message_preview AS lastMessagePreview,last_direction AS lastDirection FROM support_chats WHERE bot_id IN (' + placeholders + ')' + typeFilter + ' ORDER BY last_message_at IS NULL ASC,last_message_at DESC,updated_at DESC', params);
  return rows;
}

export async function getSupportChat(pool, botId, chatId) {
  const [rows] = await pool.query('SELECT bot_id AS botId,chat_id AS chatId,chat_type AS type,title,username,unread_count AS unreadCount FROM support_chats WHERE bot_id=? AND chat_id=? LIMIT 1', [botId, chatId]);
  return rows[0] || null;
}

export async function listSupportMessages(pool, botId, chatId, options = {}) {
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 100));
  const before = String(options.beforeMessageId || '');
  const hasBefore = /^\d+$/.test(before);
  const sql = 'SELECT CAST(message_id AS CHAR) AS messageId,direction,sender_id AS senderId,sender_name AS senderName,sender_username AS senderUsername,text_content AS text,media_type AS mediaType,media_file_id AS mediaFileId,media_url AS mediaUrl,reply_to_message_id AS replyToMessageId,entities_json AS entitiesJson,message_json AS messageJson,created_at AS createdAt FROM support_messages WHERE bot_id=? AND chat_id=?' + (hasBefore ? ' AND message_id < CAST(? AS UNSIGNED)' : '') + ' ORDER BY message_id DESC LIMIT ?';
  const params = hasBefore ? [botId, chatId, before, limit] : [botId, chatId, limit];
  const [rows] = await pool.query(sql, params);
  return rows.reverse().map(row => {
    let raw = {};
    try { raw = JSON.parse(row.messageJson || '{}') || {}; } catch {}
    // Backfill content for older rows that were stored before nested Telegram
    // service messages (for example pinned_message) were parsed.
    const details = (!String(row.text || '').trim() && !row.mediaFileId) ? describeTelegramMessage(raw) : null;
    return { ...row, messageId: String(row.messageId), text: details?.text || row.text || '', mediaType: details?.mediaType || row.mediaType, mediaFileId: details?.mediaFileId || row.mediaFileId, entities: details?.entities?.length ? details.entities : (() => { try { return JSON.parse(row.entitiesJson || '[]'); } catch { return []; } })(), replyMarkup: (() => { try { return raw?.reply_markup || raw?.pinned_message?.reply_markup || null; } catch { return null; } })() };
  });
}

export async function getSupportMessage(pool, botId, chatId, messageId) {
  const [rows] = await pool.query('SELECT media_file_id AS mediaFileId,media_type AS mediaType FROM support_messages WHERE bot_id=? AND chat_id=? AND message_id=? LIMIT 1', [botId, chatId, messageId]);
  return rows[0] || null;
}

export async function markSupportChatRead(pool, botId, chatId) {
  await pool.query('UPDATE support_chats SET unread_count=0 WHERE bot_id=? AND chat_id=?', [botId, chatId]);
}

export async function clearBotSupportHistory(pool, botId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('DELETE FROM support_messages WHERE bot_id=?', [botId]);
    await connection.query('DELETE FROM support_chats WHERE bot_id=?', [botId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
