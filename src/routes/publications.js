import { Input } from 'telegraf';
import { buildPublicationReplyMarkup, normalizeImageLinkButton } from '../publication-links.js';
import { makeId } from '../security.js';
import { toTelegramHtml } from '../telegram-content.js';

export function registerPublicationRoutes(app, dependencies) {
  const {
    state,
    persistState,
    runtimes,
    uploadedPhoto,
    uploadHandler,
    telegramPostRef,
    keyboard,
    canBotPublishToChannel,
  } = dependencies;

  app.post('/api/uploads', uploadHandler);

  app.post('/api/publish', async (req, res) => {
    const { botId, channelIds, text, photoUrl, photoKey, buttonTemplateId, imageLinkButton } =
      req.body || {};
    const runtime = runtimes.get(botId);
    if (!runtime) return res.status(400).json({ error: '所选机器人未运行，请登记新 Token 并启用' });
    const photo = photoKey ? uploadedPhoto(photoKey) : null;
    if (photoKey && !photo) return res.status(400).json({ error: '上传图片已失效，请重新上传。' });
    const telegramPost = !photo && !photoKey ? telegramPostRef(photoUrl) : null;
    const hasPhoto = Boolean(photo || photoUrl);
    let normalizedImageLinkButton;
    try {
      normalizedImageLinkButton = normalizeImageLinkButton(imageLinkButton, hasPhoto);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    if (!String(text || '').trim() && !hasPhoto)
      return res.status(400).json({ error: '请填写文字或上传图片，也可以填写图片链接。' });
    if (!Array.isArray(channelIds) || !channelIds.length)
      return res.status(400).json({ error: '请选择至少一个发布频道' });
    if (hasPhoto && String(text || '').length > 1024)
      return res.status(400).json({ error: '图片说明不能超过1024个字符' });
    const buttonTemplate = buttonTemplateId
      ? (state.menus || []).find((m) => m.id === buttonTemplateId && m.botId === botId)
      : null;
    if (buttonTemplateId && !buttonTemplate)
      return res.status(400).json({ error: '所选按钮模板不存在或不属于该机器人' });
    const templateMarkup =
      buttonTemplate && (buttonTemplate.buttons || []).length
        ? keyboard(botId, buttonTemplate).reply_markup
        : null;
    const markup = buildPublicationReplyMarkup(templateMarkup, normalizedImageLinkButton);
    const p = {
      id: makeId(),
      botId,
      text: String(text || ''),
      photoUrl: photo?.url || photoUrl || '',
      photoKey: photo ? photoKey : null,
      imageLinkButton: normalizedImageLinkButton,
      contentType: telegramPost ? 'copy' : hasPhoto ? 'photo' : 'text',
      buttonTemplateId: buttonTemplate?.id || null,
      buttonTemplateName: buttonTemplate?.name || null,
      createdAt: new Date().toISOString(),
      results: [],
    };
    for (const cid of channelIds) {
      const ch = state.channels.find((x) => x.id === cid && x.enabled);
      if (!ch) {
        p.results.push({ channelId: cid, title: '', ok: false, error: '频道不存在或已停用' });
        continue;
      }
      if (!canBotPublishToChannel(botId, cid)) {
        p.results.push({
          channelId: cid,
          title: ch.title,
          ok: false,
          error: '当前机器人不是该频道管理员，或没有发帖权限',
        });
        continue;
      }
      try {
        const options = markup ? { reply_markup: markup } : {};
        let sent;
        if (telegramPost) {
          try {
            sent = await runtime.bot.telegram.copyMessage(
              ch.chatId,
              telegramPost.chat,
              telegramPost.messageId,
              options,
            );
          } catch (copyError) {
            try {
              sent = await runtime.bot.telegram.sendPhoto(ch.chatId, photoUrl, {
                ...options,
                caption: toTelegramHtml(p.text),
                parse_mode: 'HTML',
              });
            } catch (fallbackError) {
              throw new Error(
                'Telegram 帖子复制失败：' +
                  copyError.message +
                  '；按图片链接发送也失败：' +
                  fallbackError.message +
                  '。请确认源帖子仍存在，或先下载图片后上传。',
              );
            }
          }
        } else if (hasPhoto) {
          sent = await runtime.bot.telegram.sendPhoto(
            ch.chatId,
            photo ? Input.fromLocalFile(photo.path) : photoUrl,
            { ...options, caption: toTelegramHtml(p.text), parse_mode: 'HTML' },
          );
        } else {
          sent = await runtime.bot.telegram.sendMessage(ch.chatId, toTelegramHtml(p.text), {
            ...options,
            parse_mode: 'HTML',
          });
        }
        p.results.push({
          channelId: cid,
          title: ch.title,
          ok: true,
          messageId: sent.message_id,
          contentType: sent.photo ? 'photo' : sent.text !== undefined ? 'text' : p.contentType,
        });
      } catch (e) {
        p.results.push({ channelId: cid, title: ch.title, ok: false, error: e.message });
      }
    }
    state.publications.push(p);
    state.publications = state.publications.slice(-300);
    await persistState();
    res.json(p);
  });

  app.put('/api/publications/:id', async (req, res) => {
    const publication = state.publications.find((x) => x.id === req.params.id);
    if (!publication) return res.status(404).json({ error: '发布记录不存在' });
    const runtime = runtimes.get(publication.botId);
    if (!runtime) return res.status(400).json({ error: '发布机器人未运行，请先启用机器人' });
    const text = String(req.body?.text ?? publication.text ?? '');
    const replacementPhotoKey = String(req.body?.photoKey || '').trim();
    const replacementPhotoUrl = String(req.body?.photoUrl || '').trim();
    const replacingPhoto = Boolean(replacementPhotoKey || replacementPhotoUrl);
    const photo = replacingPhoto
      ? replacementPhotoKey
        ? uploadedPhoto(replacementPhotoKey)
        : null
      : null;
    if (replacementPhotoKey && !photo)
      return res.status(400).json({ error: '上传图片已失效，请重新上传' });
    if (!text.trim() && !replacingPhoto)
      return res.status(400).json({ error: '请填写文字或图片说明' });
    if (replacingPhoto && text.length > 1024)
      return res.status(400).json({ error: '图片说明不能超过1024个字符' });
    const report = { updated: 0, unchanged: 0, failed: 0, skipped: 0, errors: [] };
    const menuChanged = req.body?.menuChanged === true;
    let selectedMenu = publication.buttonTemplateId
      ? (state.menus || []).find(
          (x) => x.id === publication.buttonTemplateId && x.botId === publication.botId,
        )
      : null;
    let replyMarkup;
    if (menuChanged) {
      const buttonTemplateId = String(req.body?.buttonTemplateId || '').trim();
      selectedMenu = buttonTemplateId
        ? (state.menus || []).find(
            (x) => x.id === buttonTemplateId && x.botId === publication.botId,
          )
        : null;
      if (buttonTemplateId && !selectedMenu)
        return res.status(400).json({ error: '所选按钮模板不存在或不属于该机器人' });
      replyMarkup = buildPublicationReplyMarkup(
        selectedMenu && (selectedMenu.buttons || []).length
          ? keyboard(publication.botId, selectedMenu).reply_markup
          : null,
        publication.imageLinkButton,
        true,
      );
    }
    for (const result of publication.results || []) {
      if (!result.ok || !result.messageId) {
        report.skipped++;
        continue;
      }
      const channel = state.channels.find((x) => x.id === result.channelId);
      if (!channel) {
        report.skipped++;
        continue;
      }
      try {
        const type =
          result.contentType || (publication.photoKey || publication.photoUrl ? 'photo' : 'text');
        const extra = { ...(menuChanged ? { reply_markup: replyMarkup } : {}), parse_mode: 'HTML' };
        if (type === 'photo') {
          if (replacingPhoto)
            await runtime.bot.telegram.editMessageMedia(
              channel.chatId,
              Number(result.messageId),
              undefined,
              {
                type: 'photo',
                media: photo ? Input.fromLocalFile(photo.path) : replacementPhotoUrl,
                caption: toTelegramHtml(text),
                parse_mode: 'HTML',
              },
              extra,
            );
          else
            await runtime.bot.telegram.editMessageCaption(
              channel.chatId,
              Number(result.messageId),
              undefined,
              toTelegramHtml(text),
              extra,
            );
        } else if (replacingPhoto) {
          throw new Error('Telegram 不支持把文字消息直接转换成图片消息，请保留文字消息类型编辑。');
        } else {
          await runtime.bot.telegram.editMessageText(
            channel.chatId,
            Number(result.messageId),
            undefined,
            toTelegramHtml(text),
            extra,
          );
        }
        result.contentType = type;
        report.updated++;
      } catch (e) {
        if (/message is not modified/i.test(e.message || '')) report.unchanged++;
        else {
          report.failed++;
          if (report.errors.length < 5)
            report.errors.push(
              (channel.title || channel.chatId) + ' #' + result.messageId + ': ' + e.message,
            );
        }
      }
    }
    publication.text = text;
    if (replacingPhoto) {
      publication.photoUrl = photo?.url || replacementPhotoUrl;
      publication.photoKey = photo ? replacementPhotoKey : null;
      publication.contentType = 'photo';
    }
    if (menuChanged) {
      publication.buttonTemplateId = selectedMenu?.id || null;
      publication.buttonTemplateName = selectedMenu?.name || selectedMenu?.title || null;
    }
    publication.editedAt = new Date().toISOString();
    await persistState();
    res.json({ publication, report });
  });
}
