import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createUploadService } from '../src/services/uploads.js';

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('uploads only images whose data URL matches the file signature', async (t) => {
  const uploadPath = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-admin-upload-'));
  t.after(() => fs.rm(uploadPath, { recursive: true, force: true }));

  const uploads = createUploadService({ uploadPath, basePath: '/tg-admin' });
  const png = Buffer.from('iVBORw0KGgo=', 'base64');
  const validResponse = createResponse();

  await uploads.uploadHandler(
    {
      body: {
        filename: 'cover.png',
        dataUrl: `data:image/png;base64,${png.toString('base64')}`,
      },
    },
    validResponse,
  );

  assert.equal(validResponse.statusCode, 201);
  assert.equal(validResponse.body.mime, 'image/png');
  assert.equal(validResponse.body.url, `/tg-admin/uploads/${validResponse.body.key}`);
  assert.deepEqual(await fs.readFile(uploads.uploadedPhoto(validResponse.body.key).path), png);
  assert.equal(uploads.uploadedPhoto('../cover.png'), null);

  const invalidResponse = createResponse();
  await uploads.uploadHandler(
    {
      body: {
        filename: 'cover.jpg',
        dataUrl: `data:image/jpeg;base64,${png.toString('base64')}`,
      },
    },
    invalidResponse,
  );

  assert.equal(invalidResponse.statusCode, 400);
  assert.match(invalidResponse.body.error, /格式无效/);
});
