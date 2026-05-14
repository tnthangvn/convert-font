const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Readable } = require('stream');
const http = require('http');
const { Server } = require('socket.io');
const opentype = require('opentype.js');
const { buildCssText } = require('./lib/build-css');
const { normalizeSvg } = require('./lib/normalize-svg');
const { parseChannelUrl, normalizeIconPayload } = require('./lib/socket-sync');

function expandHome(p) {
  if (typeof p !== 'string') return '';
  const trimmed = p.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('~/') ? path.join(os.homedir(), trimmed.slice(2)) : trimmed;
}

function readJsonBody(req) {
  return req.body || {};
}

const channelStateMeta = new Map();

const app = express();
const PORT = process.env.PORT || 3456;

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const channelState = new Map();
const channelClients = new Map();
const channelJobs = new Map();
const CHANNEL_IDLE_TTL_MS = 30 * 60 * 1000;
const MAX_UPLOAD_SIZE = 20 * 1024 * 1024;

function nowIso() {
  return new Date().toISOString();
}

function nextJobId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getChannelJob(channel) {
  return channelJobs.get(channel) || null;
}

function setChannelJob(channel, job) {
  channelJobs.set(channel, job);
}

function clearIdleChannel(channel) {
  const clients = channelClients.get(channel);
  const state = channelState.get(channel);
  const meta = channelStateMeta.get(channel);
  const job = channelJobs.get(channel);
  if (clients && clients.size > 0) return;
  if (state && Date.now() - new Date(state.updatedAt).getTime() < CHANNEL_IDLE_TTL_MS) return;
  channelClients.delete(channel);
  channelState.delete(channel);
  channelStateMeta.delete(channel);
  channelJobs.delete(channel);
}

function broadcastClientCount(channel) {
  io.to(channel).emit('channel-roster', {
    channel,
    count: getChannelClients(channel).length,
    clients: getChannelClients(channel),
  });
}

function emitPreviewError(channel, error, jobId = null) {
  io.to(channel).emit('preview-error', {
    channel,
    jobId,
    createdAt: nowIso(),
    error,
  });
}

function emitPreviewReady(channel, result, jobId) {
  const payload = {
    channel,
    jobId,
    createdAt: nowIso(),
    result,
  };
  io.to(channel).emit('preview-ready', payload);
  io.to(channel).emit('browser-preview-ready', payload);
}

function getClientLabel(socket) {
  const repoPath = socket.handshake.auth?.repoPath || socket.handshake.query?.repoPath || '';
  const repoName = repoPath ? path.basename(repoPath) : socket.id.slice(0, 8);
  return { uuid: socket.id, name: repoName, label: `${repoName}:${socket.id}`, repoPath, repoName };
}

function getChannelClients(channel) {
  return Array.from(channelClients.get(channel) || []);
}

function addChannelClient(channel, socket) {
  const list = new Map(channelClients.get(channel) || []);
  const client = getClientLabel(socket);
  list.set(socket.id, client);
  channelClients.set(channel, list);
  broadcastClientCount(channel);
  return client;
}

function removeChannelClient(channel, socketId) {
  const list = channelClients.get(channel);
  if (!list) return;
  list.delete(socketId);
  if (list.size === 0) {
    channelClients.delete(channel);
    broadcastClientCount(channel);
    clearIdleChannel(channel);
    return;
  }
  broadcastClientCount(channel);
}

function upsertChannelGlyphs(channel, glyphs) {
  channelState.set(channel, {
    updatedAt: nowIso(),
    glyphs,
  });
}

function validateChannel(channel) {
  return typeof channel === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(channel);
}

function getChannelGlyphs(channel) {
  return channelState.get(channel)?.glyphs || [];
}

function setChannelMeta(channel, meta) {
  channelStateMeta.set(channel, {
    updatedAt: new Date().toISOString(),
    ...meta,
  });
}

function getChannelMeta(channel) {
  return channelStateMeta.get(channel) || null;
}

function persistChannelMeta(channel, glyphs, fontName = 'CustomFont', cssPrefix = 'icon', client = null) {
  upsertChannelGlyphs(channel, glyphs);
  setChannelMeta(channel, {
    channel,
    fontName,
    cssPrefix,
    glyphCount: glyphs.length,
    repoPath: client?.repoPath || null,
    repoName: client?.repoName || null,
  });
}

io.on('connection', (socket) => {
  console.log({ socket: socket.id, event: 'connection', time: nowIso() });
  socket.data.isBrowser = socket.handshake.auth?.isBrowser === true || socket.handshake.query?.isBrowser === 'true';

  socket.on('join-preview-channel', ({ channel }) => {
    if (!validateChannel(channel)) {
      socket.emit('channel-error', { error: 'channel is required' });
      return;
    }

    socket.join(channel);
    const client = addChannelClient(channel, socket);
    const meta = getChannelMeta(channel) || { channel, fontName: 'CustomFont', cssPrefix: 'icon', glyphCount: getChannelGlyphs(channel).length };
    persistChannelMeta(channel, getChannelGlyphs(channel), meta.fontName || 'CustomFont', meta.cssPrefix || 'icon', client);

    socket.emit('channel-joined', {
      channel,
      glyphCount: getChannelGlyphs(channel).length,
      meta: getChannelMeta(channel),
      roster: { count: getChannelClients(channel).length, clients: getChannelClients(channel) },
    });

    const latestPreview = getChannelJob(channel)?.latestPreview || channelState.get(channel)?.preview || null;
    if (latestPreview) {
      socket.emit('preview-ready', {
        channel,
        jobId: latestPreview.jobId,
        createdAt: latestPreview.createdAt,
        result: latestPreview.result,
      });
    }
  });

  socket.on('leave-preview-channel', ({ channel }) => {
    if (!validateChannel(channel)) return;
    socket.leave(channel);
    removeChannelClient(channel, socket.id);
  });

  socket.on('leave-channel', ({ channel }) => {
    if (!validateChannel(channel)) return;
    socket.leave(channel);
    removeChannelClient(channel, socket.id);
  });

  socket.on('disconnect', () => {
    for (const [channel, clients] of channelClients.entries()) {
      if (clients.has(socket.id)) removeChannelClient(channel, socket.id);
    }
  });

  socket.on('sync-glyphs', ({ channel, glyphs }) => {
    try {
      const normalized = normalizeIconPayload(glyphs);
      persistChannelMeta(channel, normalized, getChannelMeta(channel)?.fontName || 'CustomFont', getChannelMeta(channel)?.cssPrefix || 'icon');
      io.to(channel).emit('glyphs-updated', {
        channel,
        glyphs: normalized,
        meta: getChannelMeta(channel),
      });
    } catch (error) {
      socket.emit('channel-error', { error: error.message });
    }
  });

  socket.on('request-glyphs', ({ channel }) => {
    socket.emit('glyphs-current', {
      channel,
      glyphs: getChannelGlyphs(channel),
    });
  });

  socket.on('add-icons', ({ channel, icons }) => {
    try {
      const existing = getChannelGlyphs(channel);
      const incoming = normalizeIconPayload(icons);
      const merged = [...existing, ...incoming];
      persistChannelMeta(channel, merged, getChannelMeta(channel)?.fontName || 'CustomFont', getChannelMeta(channel)?.cssPrefix || 'icon');
      io.to(channel).emit('glyphs-updated', {
        channel,
        glyphs: merged,
        meta: getChannelMeta(channel),
      });
    } catch (error) {
      socket.emit('channel-error', { error: error.message });
    }
  });
});

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

function pathCommandsToData(commands, yTransform = null) {
  if (!Array.isArray(commands) || commands.length === 0) return '';
  const y = (value) => yTransform ? yTransform(value) : value;
  return commands.map((cmd) => {
    switch (cmd.type) {
      case 'M': return `M ${cmd.x} ${y(cmd.y)}`;
      case 'L': return `L ${cmd.x} ${y(cmd.y)}`;
      case 'C': return `C ${cmd.x1} ${y(cmd.y1)} ${cmd.x2} ${y(cmd.y2)} ${cmd.x} ${y(cmd.y)}`;
      case 'Q': return `Q ${cmd.x1} ${y(cmd.y1)} ${cmd.x} ${y(cmd.y)}`;
      case 'A': return `A ${cmd.rX} ${cmd.rY} ${cmd.xRot} ${cmd.lArcFlag} ${cmd.sweepFlag ? 0 : 1} ${cmd.x} ${y(cmd.y)}`;
      case 'Z': return 'Z';
      default: return '';
    }
  }).filter(Boolean).join(' ');
}

/**
 * Parse an existing .woff file and return glyph metadata.
 */
function parseWoff(buffer) {
  const fontBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const font = opentype.parse(fontBuffer, { lowMemory: false });
  const ascender = font.ascender || font.unitsPerEm * 0.8;
  const unitsPerEm = font.unitsPerEm || 1000;
  const glyphs = [];

  for (let i = 0; i < font.glyphs.length; i++) {
    const g = font.glyphs.get(i);
    if (!g.unicode && g.index !== 0) continue;

    let svgPath = '';
    try {
      const commands = g.path?.commands || (typeof g.getPath === 'function' ? g.getPath(0, 0, unitsPerEm).commands : null);
      svgPath = pathCommandsToData(commands, (value) => unitsPerEm - value);
    } catch (_) { /* ignore */ }

    glyphs.push({
      index: g.index,
      name: g.name || `glyph_${g.index}`,
      unicode: g.unicode,
      unicodeHex: g.unicode ? 'U+' + g.unicode.toString(16).toUpperCase().padStart(4, '0') : null,
      svgPathData: svgPath,
      advanceWidth: g.advanceWidth,
    });
  }
  return {
    fontFamily: font.names?.fontFamily?.en || font.names?.fontFamily || 'Unknown',
    unitsPerEm,
    ascender,
    numGlyphs: font.glyphs.length,
    glyphs,
  };
}

/**
 * Generate .woff buffer from SVG content strings + optional existing glyphs.
 * Pipeline: svgicons2svgfont → svg2ttf → ttf2woff
 */
async function generateWoff(svgItems, fontName = 'CustomFont', existingWoffBuffer = null, glyphMeta = null) {
  // Dynamic imports for ESM-only packages
  const { SVGIcons2SVGFontStream } = await import('svgicons2svgfont');
  const svg2ttf = (await import('svg2ttf')).default;
  const ttf2woff = (await import('ttf2woff')).default;

  // Determine starting codepoint (Private Use Area)
  let nextCodepoint = 0xE001;
  const skippedGlyphs = [];

  // If glyphMeta is provided, the client is sending the full ordered list
  // with user-defined names and codepoints
  const allSvgItems = [];

  if (glyphMeta && Array.isArray(glyphMeta) && glyphMeta.length > 0) {
    // Client controls everything — use glyphMeta order/names/codepoints
    for (const meta of glyphMeta) {
      const svgContent = meta.svgContent;
      if (!svgContent) continue;
      allSvgItems.push({
        name: meta.name || 'glyph',
        codepoint: meta.codepoint || nextCodepoint++,
        svgContent,
      });
    }
  } else {
    // Legacy path: auto-assign codepoints
    if (existingWoffBuffer) {
      const parsed = parseWoff(existingWoffBuffer);
      fontName = fontName || parsed.fontFamily || 'CustomFont';
      for (const g of parsed.glyphs) {
        if (!g.svgPathData || g.index === 0) continue;
        const cp = g.unicode || nextCodepoint++;
        if (cp >= nextCodepoint) nextCodepoint = cp + 1;
        const unitsPerEm = parsed.unitsPerEm || 1000;
        const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${unitsPerEm} ${unitsPerEm}">
  <path d="${g.svgPathData}"/>
</svg>`;
        allSvgItems.push({
          name: g.name,
          codepoint: cp,
          svgContent,
        });
      }
    }

    for (const item of svgItems) {
      allSvgItems.push({
        name: item.name,
        codepoint: nextCodepoint++,
        svgContent: item.svgContent,
      });
    }
  }

  if (allSvgItems.length === 0) {
    throw new Error('No glyphs to generate. Please add at least one SVG file.');
  }

  const validSvgItems = [];
  for (const item of allSvgItems) {
    try {
      const normalized = normalizeSvg(item.svgContent);
      validSvgItems.push({ ...item, svgContent: normalized.svgContent });
    } catch (error) {
      skippedGlyphs.push(item.name || 'glyph');
    }
  }

  if (validSvgItems.length === 0) {
    throw new Error('No valid SVG glyphs to generate.');
  }

  if (skippedGlyphs.length > 0) {
    console.warn(`Skipped invalid glyphs: ${skippedGlyphs.join(', ')}`);
  }

  if (allSvgItems.length === 0) {
    throw new Error('No glyphs to generate. Please add at least one SVG file.');
  }

  // Step 1: SVGs → SVG Font
  const svgFontData = await new Promise((resolve, reject) => {
    const fontStream = new SVGIcons2SVGFontStream({
      fontName,
      normalize: true,
      fontHeight: 1000,
      log: () => {},
    });

    let result = '';
    fontStream.on('data', (chunk) => {
      result += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    });
    fontStream.on('end', () => resolve(result));
    fontStream.on('error', reject);

    for (const item of allSvgItems) {
      const glyphStream = new Readable({ read() {} });
      glyphStream.metadata = {
        name: item.name,
        unicode: [String.fromCodePoint(item.codepoint)],
      };
      glyphStream.push(item.svgContent);
      glyphStream.push(null);
      fontStream.write(glyphStream);
    }

    fontStream.end();
  });

  // Step 2: SVG Font → TTF
  const ttfResult = svg2ttf(svgFontData, {});
  const ttfBuffer = Buffer.from(ttfResult.buffer);

  // Step 3: TTF → WOFF
  const woffResult = ttf2woff(new Uint8Array(ttfBuffer));
  return Buffer.from(woffResult.buffer);
}

// ── Latest Bundle Persistence ───────────────────────────────

const LATEST_DIR = path.join(__dirname, 'data', 'latest');

/**
 * Persist the latest generated bundle to disk for MCP export.
 * @param {Buffer} woffBuffer
 * @param {Array} glyphs  — [{ name, codepoint, svgContent }]
 * @param {string} fontFamily
 * @param {string} cssPrefix
 */
function persistLatestBundle(woffBuffer, glyphs, fontFamily, cssPrefix = 'icon') {
  fs.mkdirSync(LATEST_DIR, { recursive: true });

  // Write .woff
  fs.writeFileSync(path.join(LATEST_DIR, 'font.woff'), woffBuffer);

  // Build metadata
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
        cssContentEscape: `\\${cp.toString(16).toLowerCase()}`,
        previewSvg: g.svgContent || '',
      };
    }),
  };

  fs.writeFileSync(
    path.join(LATEST_DIR, 'metadata.json'),
    JSON.stringify(metadata, null, 2),
  );
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
    const { targetPath, blob } = readJsonBody(req);
    const resolvedPath = expandHome(targetPath);
    if (!resolvedPath) {
      return res.status(400).json({ error: 'targetPath is required.' });
    }
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: `Target file not found: ${targetPath}` });
    }
    if (!blob) {
      return res.status(400).json({ error: 'blob is required.' });
    }

    const buffer = Buffer.from(blob, 'base64');
    fs.writeFileSync(resolvedPath, buffer);
    return res.json({ success: true, targetPath: resolvedPath, size: buffer.length });
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


// ── Serve SPA ────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Only start the server when run directly (allows testing without port binding)
app.post('/api/socket/sync-from-channel', async (req, res) => {
  try {
    const { channelUrl, fontName = 'CustomFont' } = req.body || {};
    const { channel } = parseChannelUrl(channelUrl);
    const glyphs = getChannelGlyphs(channel);

    if (!glyphs.length) {
      return res.status(404).json({ error: `No glyphs found for channel "${channel}".` });
    }

    const woffBuffer = await generateWoff([], fontName, null, glyphs);
    persistLatestBundle(woffBuffer, glyphs, fontName, req.body?.cssPrefix || 'icon');
    persistChannelMeta(channel, glyphs, fontName, req.body?.cssPrefix || 'icon');

    res.json({
      success: true,
      channel,
      glyphCount: glyphs.length,
      latestDir: LATEST_DIR,
      meta: getChannelMeta(channel),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/socket/parse-woff-preview', upload.single('woffFile'), async (req, res) => {
  const channel = req.body?.channel;
  const jobId = req.body?.jobId || nextJobId();
  try {
    if (!validateChannel(channel)) {
      return res.status(400).json({ error: 'channel is required.' });
    }
    if (!req.file) {
      emitPreviewError(channel, 'No file uploaded.', jobId);
      return res.status(400).json({ error: 'No file uploaded.' });
    }
    const buffer = fs.readFileSync(req.file.path);
    const result = parseWoff(buffer);
    const preview = { jobId, createdAt: nowIso(), result };
    setChannelJob(channel, { ...(getChannelJob(channel) || {}), latestPreview: preview });
    channelState.set(channel, { ...(channelState.get(channel) || {}), preview });
    emitPreviewReady(channel, result, jobId);
    res.json({ ...result, meta: { channel, jobId, createdAt: preview.createdAt } });
  } catch (err) {
    if (validateChannel(channel)) emitPreviewError(channel, err.message, jobId);
    res.status(400).json({ error: err.message });
  } finally {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
  }
});

app.post('/api/channel/:channel/icons', express.json(), async (req, res) => {
  try {
    const { channel } = req.params;
    const { action, icons = [], fontName = 'CustomFont', cssPrefix = 'icon' } = req.body || {};
    const current = getChannelGlyphs(channel);
    let next = current;
    if (action === 'add') next = [...current, ...normalizeIconPayload(icons)];
    else if (action === 'update') next = normalizeIconPayload(icons);
    else if (action === 'delete') {
      const names = new Set(normalizeIconPayload(icons).map((icon) => icon.name));
      next = current.filter((icon) => !names.has(icon.name));
    } else {
      return res.status(400).json({ error: 'Invalid action.' });
    }
    persistChannelMeta(channel, next, fontName, cssPrefix);
    const woffBuffer = await generateWoff([], fontName, null, next);
    persistLatestBundle(woffBuffer, next, fontName, cssPrefix);
    res.json({ success: true, channel, glyphs: next, meta: getChannelMeta(channel) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`✨ WOFF Tool running at http://localhost:${PORT}`);
  });
}

module.exports = { app, server, io, buildCssText, normalizeSvg, persistLatestBundle };
