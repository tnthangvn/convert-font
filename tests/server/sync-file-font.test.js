const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
const http = require('http');
const { app } = require('../../server');

describe('POST /api/sync-file-font', () => {
  let serverInstance;
  let port;
  let baseUrl;
  const tempDir = path.join(__dirname, 'temp_sync_test');

  before(async () => {
    // Set up temp directory
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Start server on a dynamic port
    await new Promise((resolve) => {
      serverInstance = http.createServer(app);
      serverInstance.listen(0, '127.0.0.1', () => {
        port = serverInstance.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    // Close server
    if (serverInstance) {
      serverInstance.close();
    }
  });

  it('successfully syncs only the font file when cssPath is omitted', async () => {
    const testFontPath = path.join(tempDir, 'only-font.woff');
    const fakeBase64 = Buffer.from('Fake WOFF Data').toString('base64');

    const res = await fetch(`${baseUrl}/api/sync-file-font`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetPath: testFontPath,
        blob: fakeBase64,
      }),
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.equal(json.targetPath, testFontPath);
    assert.equal(json.syncedCssPath, null);

    // Verify font file exists on disk
    assert.equal(fs.existsSync(testFontPath), true);
    assert.equal(fs.readFileSync(testFontPath, 'utf8'), 'Fake WOFF Data');
  });

  it('successfully syncs both font and css files with relative path calculation', async () => {
    const testFontPath = path.join(tempDir, 'subfolder', 'font.woff');
    const testCssPath = path.join(tempDir, 'styles.css');
    const fakeBase64 = Buffer.from('Fake Font Data').toString('base64');

    // Ensure subfolder exists
    fs.mkdirSync(path.dirname(testFontPath), { recursive: true });

    const res = await fetch(`${baseUrl}/api/sync-file-font`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetPath: testFontPath,
        blob: fakeBase64,
        cssPath: testCssPath,
        fontFamily: 'MySyncedFont',
        prefix: 'synced-icon',
        glyphs: [
          { name: 'heart', codepoint: 0xe001 },
          { name: 'star', codepoint: 0xe002 }
        ],
      }),
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.equal(json.targetPath, testFontPath);
    assert.equal(json.syncedCssPath, testCssPath);

    // Verify both files exist
    assert.equal(fs.existsSync(testFontPath), true);
    assert.equal(fs.existsSync(testCssPath), true);

    // Verify CSS contents and relative path
    const cssContent = fs.readFileSync(testCssPath, 'utf8');
    assert.match(cssContent, /font-family:\s*'MySyncedFont'/);
    // Relative path from tempDir/styles.css to tempDir/subfolder/font.woff is subfolder/font.woff
    assert.match(cssContent, /url\('subfolder\/font\.woff\?/);
    assert.match(cssContent, /\.synced-icon-heart:before/);
    assert.match(cssContent, /content: '\\e001'/);
  });

  it('returns 404 if target folder does not exist', async () => {
    const invalidPath = path.join(tempDir, 'nonexistent_folder_abc_123', 'font.woff');
    const fakeBase64 = Buffer.from('Data').toString('base64');

    const res = await fetch(`${baseUrl}/api/sync-file-font`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetPath: invalidPath,
        blob: fakeBase64,
      }),
    });

    assert.equal(res.status, 404);
    const json = await res.json();
    assert.match(json.error, /Target folder not found/);
  });
});
