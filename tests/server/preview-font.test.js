'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');

const { app } = require('../../server');

const REPO_WOFF = path.join(__dirname, '..', '..', 'public', 'fonts', 'RV-Icon.woff');

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = http.createServer(app).listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('GET /api/repo-fonts lists the repo font', async () => {
  const res = await fetch(`${base}/api/repo-fonts`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.fonts));
  assert.ok(body.fonts.some((f) => f.family === 'RV-Icon'));
});

test('POST /api/preview-font 404s on a missing font', async () => {
  const res = await fetch(`${base}/api/preview-font`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: '/nope/does-not-exist.woff' }),
  });
  assert.equal(res.status, 404);
});

test('POST /api/preview-font 400s without a path', async () => {
  const res = await fetch(`${base}/api/preview-font`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});

test('POST /api/preview-font broadcasts and /api/active-preview replays', async () => {
  const res = await fetch(`${base}/api/preview-font`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: REPO_WOFF }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(body.glyphCount > 0);
  assert.equal(body.family, 'RV-Icon', 'falls back to filename when name table is empty');

  const active = await fetch(`${base}/api/active-preview`);
  assert.equal(active.status, 200);
  const payload = await active.json();
  assert.equal(payload.fontFamily, 'RV-Icon');
  assert.ok(Array.isArray(payload.glyphs) && payload.glyphs.length > 0);
});
