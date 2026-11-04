import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function createUploadService({ uploadPath, basePath }) {
  function detectImageMime(buffer) {
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
      return 'image/jpeg';
    if (
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    )
      return 'image/png';
    if (
      buffer.length >= 6 &&
      ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))
    )
      return 'image/gif';
    if (
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    )
      return 'image/webp';
    return '';
  }

  function uploadedPhoto(photoKey) {
    if (!/^[a-f0-9]{32}\.(?:jpg|png|gif|webp)$/.test(String(photoKey || ''))) return null;
    const filePath = path.resolve(uploadPath, photoKey);
    if (
      path.dirname(filePath) !== uploadPath ||
      !fs.existsSync(filePath) ||
      !fs.statSync(filePath).isFile()
    )
      return null;
    return { path: filePath, url: basePath + '/uploads/' + photoKey };
  }

  async function uploadHandler(req, res) {
    const { filename, dataUrl } = req.body || {};
    const match = String(dataUrl || '').match(
      /^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/=\r\n]+)$/,
    );
    if (!match) return res.status(400).json({ error: '请选择 JPG、PNG、GIF 或 WebP 图片。' });

    const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    if (!buffer.length || buffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: '图片大小不能超过 10 MB。' });
    }

    const mime = detectImageMime(buffer);
    if (!mime || mime !== match[1]) {
      return res.status(400).json({ error: '图片文件格式无效或与文件内容不匹配。' });
    }

    const extension = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
    }[mime];
    const key = crypto.randomBytes(16).toString('hex') + '.' + extension;

    try {
      await fs.promises.mkdir(uploadPath, { recursive: true });
      await fs.promises.writeFile(path.resolve(uploadPath, key), buffer, { flag: 'wx' });
      res.status(201).json({
        key,
        url: uploadedPhoto(key).url,
        filename: path.basename(String(filename || '图片')).slice(0, 160),
        mime,
        size: buffer.length,
      });
    } catch {
      res.status(500).json({ error: '图片保存失败，请稍后重试。' });
    }
  }

  return { uploadedPhoto, uploadHandler };
}
