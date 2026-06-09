'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeImage, iconPath, ICON_DIR } = require('./catIcons');

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]; // SOI + APP0
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

test('decodeImage: validní JPEG data URL → buffer + ext jpg', () => {
  const out = decodeImage(`data:image/jpeg;base64,${b64(JPEG)}`);
  assert.ok(out);
  assert.equal(out.ext, 'jpg');
  assert.deepEqual([...out.buffer.subarray(0, 3)], [0xff, 0xd8, 0xff]);
});

test('decodeImage: validní PNG data URL → ext png', () => {
  const out = decodeImage(`data:image/png;base64,${b64(PNG)}`);
  assert.ok(out);
  assert.equal(out.ext, 'png');
});

test('decodeImage: JPEG prefix ale PNG bytes → null (magic byte mismatch)', () => {
  assert.equal(decodeImage(`data:image/jpeg;base64,${b64(PNG)}`), null);
});

test('decodeImage: nepodporovaný typ / žádný prefix → null', () => {
  assert.equal(decodeImage(`data:image/gif;base64,${b64(JPEG)}`), null);
  assert.equal(decodeImage('not-a-data-url'), null);
  assert.equal(decodeImage(''), null);
  assert.equal(decodeImage(null), null);
});

test('iconPath: bere jen basename (žádný path traversal)', () => {
  const p = iconPath('../../etc/passwd');
  assert.ok(p.startsWith(ICON_DIR));
  assert.ok(p.endsWith('passwd'));
  assert.ok(!p.includes('..'));
});
