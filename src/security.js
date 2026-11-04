import crypto from 'node:crypto';

export const makeId = () => crypto.randomUUID();

function secretKey(secret) {
  return crypto.createHash('sha256').update(secret).digest();
}

export function encrypt(value, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(secret), iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    body.toString('base64'),
  ].join('.');
}

export function decrypt(value, secret) {
  const [iv, tag, body] = value.split('.');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    secretKey(secret),
    Buffer.from(iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}
