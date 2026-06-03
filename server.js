const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { buildCssText, mergeCssText } = require('./lib/build-css');
const { normalizeSvg } = require('./lib/normalize-svg');
const { parseWoff } = require('./lib/parse-woff');
const { generateWoff } = require('./lib/generate-woff');
const { discoverFonts } = require('./lib/repo-fonts');

function expandHome(p) {
  if (typeof p !== 'string') return '';
  const trimmed = p.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('~/') ? path.join(os.homedir(), trimmed.slice(2)) : trimmed;
}

function readJsonBody(req) {
  return req.body || {};
}

const http = require('http');

const app = express();
const PORT = process.env.PORT || 3456;

const MAX_UPLOAD_SIZE = 20 * 1024 * 1024;
const server = http.createServer(app);
const LATEST_DIR = path.join(__dirname, 'data', 'latest');

// ── Live preview (SSE) ───────────────────────────────────────
// The browser subscribes to /api/preview-stream; an agent/MCP triggers a
// preview via POST /api/preview-font, which broadcasts to every open tab.
let sseClients = [];
let activePreview = null;

function nowIso() {
  return new Date().toISOString();
}

function broadcastPreview(result) {
  activePreview = result;
  const msg = `event: preview-ready\ndata: ${JSON.stringify(result)}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch (_) { /* dropped on next close */ }
  }
}

function persistLatestBundle(woffBuffer, glyphs, fontFamily, cssPrefix = 'icon') {
  fs.mkdirSync(LATEST_DIR, { recursive: true });

  fs.writeFileSync(path.join(LATEST_DIR, 'font.woff'), woffBuffer);

  const metadata = {
    fontFamily,
    generatedAt: new Date().toISOString(),
    glyphs: glyphs.map(g => {
      const cp = g.codepoint || 0;
      return {
        name: g.name,
        codepoint: cp,
        unicodeHex: 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'),
        cssSelector: `.${cssPrefix}-${(g.name || 'glyph').replace(/[^a-zA-Z0-9_-]/g, '-')}`,
        cssContentEscape: `\${cp.toString(16).toLowerCase()}`,
        previewSvg: g.svgContent || '',
      };
    }),
  };

  fs.writeFileSync(path.join(LATEST_DIR, 'metadata.json'), JSON.stringify(metadata, null, 2));
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Multer config — store uploads in tmp
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: MAX_UPLOAD_SIZE },
});

// ── Helpers ──────────────────────────────────────────────────

function sanitizeGlyphName(filename) {
  return path.basename(filename, path.extname(filename))
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'glyph';
}

// ── API Routes ──────────────────────────────────────────────

/**
 * POST /api/parse-woff
 * Upload a .woff file → returns glyph metadata JSON
 */
app.post('/api/parse-woff', upload.single('woffFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }
    if (!req.file.originalname.toLowerCase().endsWith('.woff')) {
      return res.status(400).json({ error: 'Only .woff files are accepted.' });
    }

    const buffer = fs.readFileSync(req.file.path);
    const result = parseWoff(buffer);
    res.json(result);
  } catch (err) {
    console.error('parse-woff error:', err);
    res.status(400).json({ error: `Failed to parse .woff file: ${err.message}` });
  } finally {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
  }
});

/**
 * POST /api/generate
 * Accepts multipart form with:
 *   - woffFile (optional) — existing .woff to merge into
 *   - svgFiles[] — one or more .svg files
 *   - fontName (optional) — custom font name
 * Returns the generated .woff binary.
 */
app.post('/api/generate', upload.fields([
  { name: 'woffFile', maxCount: 1 },
  { name: 'svgFiles', maxCount: 200 },
]), async (req, res) => {
  const filesToClean = [];
  try {
    const svgFiles = req.files?.svgFiles || [];
    const woffFiles = req.files?.woffFile || [];
    const fontName = req.body?.fontName || 'CustomFont';

    // Check if client sent glyphMeta (new path)
    let glyphMeta = null;
    if (req.body?.glyphMeta) {
      try {
        glyphMeta = JSON.parse(req.body.glyphMeta);
      } catch (_) {
        return res.status(400).json({ error: 'Invalid glyphMeta JSON.' });
      }
    }

    // If glyphMeta is provided, it contains all the SVG content inline
    if (glyphMeta && glyphMeta.length > 0) {
      const woffBuffer = await generateWoff([], fontName, null, glyphMeta);

      // Persist bundle for MCP export
      try {
        persistLatestBundle(woffBuffer, glyphMeta, fontName, req.body.cssPrefix || 'icon');
      } catch (e) {
        console.error('Failed to persist latest bundle:', e.message);
      }

      res.set({
        'Content-Type': 'font/woff',
        'Content-Disposition': `attachment; filename="${fontName}.woff"`,
        'Content-Length': woffBuffer.length,
      });
      return res.send(woffBuffer);
    }

    // Legacy path: SVG files uploaded
    if (svgFiles.length === 0) {
      return res.status(400).json({ error: 'At least one .svg file is required.' });
    }

    for (const f of svgFiles) {
      filesToClean.push(f.path);
      if (!f.originalname.toLowerCase().endsWith('.svg')) {
        return res.status(400).json({ error: `File "${f.originalname}" is not an .svg file.` });
      }
    }

    // Validate optional WOFF
    let existingWoffBuffer = null;
    if (woffFiles.length > 0) {
      const wf = woffFiles[0];
      filesToClean.push(wf.path);
      if (!wf.originalname.toLowerCase().endsWith('.woff')) {
        return res.status(400).json({ error: 'The base font file must be .woff format.' });
      }
      existingWoffBuffer = fs.readFileSync(wf.path);
    }

    // Read SVG contents
    const svgItems = [];
    const errors = [];
    for (const f of svgFiles) {
      const content = fs.readFileSync(f.path, 'utf-8');
      if (!content.includes('<svg') && !content.includes('<SVG')) {
        errors.push(`"${f.originalname}" is not a valid SVG file.`);
        continue;
      }
      svgItems.push({
        name: sanitizeGlyphName(f.originalname),
        svgContent: content,
      });
    }

    if (errors.length > 0 && svgItems.length === 0) {
      return res.status(400).json({ error: 'All SVG files were invalid:\n' + errors.join('\n') });
    }

    // Generate
    const woffBuffer = await generateWoff(svgItems, fontName, existingWoffBuffer);

    // Respond with warnings if any files were skipped
    res.set({
      'Content-Type': 'font/woff',
      'Content-Disposition': `attachment; filename="${fontName}.woff"`,
      'Content-Length': woffBuffer.length,
    });
    if (errors.length > 0) {
      res.set('X-Warnings', JSON.stringify(errors));
    }
    res.send(woffBuffer);

  } catch (err) {
    console.error('generate error:', err);
    res.status(500).json({ error: `Generation failed: ${err.message}` });
  } finally {
    for (const p of filesToClean) {
      fs.unlink(p, () => {});
    }
  }
});

/**
 * POST /api/generate-css
 * Generates a CSS file for icon font usage.
 * Body JSON: { fontFamily, prefix, fontPath, glyphs: [{ name, codepoint }] }
 */
app.post('/api/generate-css', express.json(), (req, res) => {
  try {
    const { fontFamily = 'CustomFont', prefix = 'icon', fontPath = 'fonts/font.woff', glyphs = [] } = req.body;

    if (!glyphs || glyphs.length === 0) {
      return res.status(400).json({ error: 'No glyphs provided for CSS generation.' });
    }

    const css = buildCssText({ fontFamily, prefix, fontPath, glyphs });

    res.set({
      'Content-Type': 'text/css; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fontFamily}.css"`,
    });
    res.send(css);
  } catch (err) {
    console.error('generate-css error:', err);
    res.status(500).json({ error: `CSS generation failed: ${err.message}` });
  }
});

/**
 * POST /api/normalize
 * Normalize an SVG to a target size and alignment.
 * Body JSON: { svgContent, targetWidth, targetHeight, alignH, alignV }
 */
app.post('/api/sync-file-font', express.json({ limit: '25mb' }), (req, res) => {
  try {
    const { targetPath, blob, cssPath, fontFamily, prefix, glyphs } = readJsonBody(req);
    const resolvedPath = expandHome(targetPath);
    if (!resolvedPath) {
      return res.status(400).json({ error: 'targetPath is required.' });
    }
    if (!blob) {
      return res.status(400).json({ error: 'blob is required.' });
    }

    const parentDir = path.dirname(resolvedPath);
    if (!fs.existsSync(parentDir)) {
      return res.status(404).json({ error: `Target folder not found: ${parentDir}` });
    }

    const buffer = Buffer.from(blob, 'base64');
    fs.writeFileSync(resolvedPath, buffer);

    let syncedCssPath = null;
    if (cssPath) {
      const resolvedCssPath = expandHome(cssPath);
      const cssParentDir = path.dirname(resolvedCssPath);
      if (!fs.existsSync(cssParentDir)) {
        return res.status(404).json({ error: `Target CSS folder not found: ${cssParentDir}` });
      }

      // Calculate relative path from CSS file directory to WOFF file path
      let relativeFontPath = path.relative(cssParentDir, resolvedPath);
      // Normalize slashes for CSS URL
      relativeFontPath = relativeFontPath.replace(/\\/g, '/');

      const cssOptions = {
        fontFamily: fontFamily || 'CustomFont',
        prefix: prefix || 'icon',
        fontPath: relativeFontPath,
        glyphs: glyphs || [],
      };
      const cssText = fs.existsSync(resolvedCssPath)
        ? mergeCssText({ existingCss: fs.readFileSync(resolvedCssPath, 'utf-8'), ...cssOptions })
        : buildCssText(cssOptions);

      fs.writeFileSync(resolvedCssPath, cssText, 'utf-8');
      syncedCssPath = resolvedCssPath;
    }

    return res.json({
      success: true,
      targetPath: resolvedPath,
      size: buffer.length,
      syncedCssPath: syncedCssPath
    });
  } catch (err) {
    console.error('sync-file-font error:', err);
    return res.status(500).json({ error: `Sync failed: ${err.message}` });
  }
});

app.post('/api/normalize', express.json(), (req, res) => {
  try {
    const { svgContent, targetWidth, targetHeight, alignH, alignV } = req.body;
    const result = normalizeSvg({ svgContent, targetWidth, targetHeight, alignH, alignV });
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    res.json({ normalizedSvg: result.normalizedSvg });
  } catch (err) {
    console.error('normalize error:', err);
    res.status(500).json({ error: `Normalization failed: ${err.message}` });
  }
});

/**
 * GET /api/latest-bundle
 * Returns the latest generated bundle metadata (diagnostic endpoint).
 */
app.get('/api/latest-bundle', (req, res) => {
  try {
    const metaPath = path.join(LATEST_DIR, 'metadata.json');
    if (!fs.existsSync(metaPath)) {
      return res.status(404).json({ error: 'No generated bundle available. Generate a .woff first using the WOFF Tool UI.' });
    }
    const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    res.json(metadata);
  } catch (err) {
    console.error('latest-bundle error:', err);
    res.status(500).json({ error: `Failed to read latest bundle: ${err.message}` });
  }
});

/**
 * GET /api/repo-fonts
 * List .woff fonts that live in the repository (for the "which font?" picker).
 */
app.get('/api/repo-fonts', (req, res) => {
  try {
    res.json({ fonts: discoverFonts(__dirname) });
  } catch (err) {
    console.error('repo-fonts error:', err);
    res.status(500).json({ error: `Failed to list repo fonts: ${err.message}` });
  }
});

/**
 * GET /api/preview-stream
 * Server-Sent Events stream. Browser tabs subscribe here and receive a
 * `preview-ready` event whenever a font is pushed for preview. The current
 * active preview (if any) is replayed immediately on connect.
 */
app.get('/api/preview-stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  sseClients.push(res);
  if (activePreview) {
    res.write(`event: preview-ready\ndata: ${JSON.stringify(activePreview)}\n\n`);
  }

  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch (_) { /* closed */ }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients = sseClients.filter((c) => c !== res);
  });
});

/**
 * POST /api/preview-font  { path }
 * Read + parse a repo .woff and broadcast it to all open tabs.
 */
app.post('/api/preview-font', express.json(), (req, res) => {
  try {
    const woffPath = expandHome(req.body?.path || '');
    if (!woffPath) {
      return res.status(400).json({ error: 'path is required.' });
    }
    if (!fs.existsSync(woffPath)) {
      return res.status(404).json({ error: `Font not found: ${woffPath}` });
    }
    const buffer = fs.readFileSync(woffPath);
    const parsed = parseWoff(buffer);
    const family = (parsed.fontFamily && parsed.fontFamily !== 'Unknown')
      ? parsed.fontFamily
      : path.basename(woffPath, path.extname(woffPath));
    const result = {
      fontFamily: family,
      unitsPerEm: parsed.unitsPerEm,
      glyphs: parsed.glyphs,
      sourcePath: woffPath,
      generatedAt: nowIso(),
    };

    try {
      persistLatestBundle(buffer, parsed.glyphs, family);
    } catch (e) {
      console.error('Failed to persist preview bundle:', e.message);
    }

    broadcastPreview(result);
    return res.json({
      success: true,
      family,
      glyphCount: parsed.glyphs.length,
      clients: sseClients.length,
    });
  } catch (err) {
    console.error('preview-font error:', err);
    return res.status(500).json({ error: `Preview failed: ${err.message}` });
  }
});

/**
 * GET /api/active-preview
 * Bootstrap endpoint: a freshly opened tab fetches the current active preview.
 */
app.get('/api/active-preview', (req, res) => {
  if (!activePreview) {
    return res.status(404).json({ error: 'No active preview.' });
  }
  res.json(activePreview);
});


// ── Serve SPA ────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Only start the server when run directly (allows testing without port binding)

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`✨ WOFF Tool running at http://localhost:${PORT}`);
  });
}

module.exports = { app, server, buildCssText, normalizeSvg, persistLatestBundle };
