/* ── WOFF Tool — App Logic ─────────────────────────────── */
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────
  let _idCounter = 0;
  const state = {
    mode: 'start', // 'start' | 'workspace'
    existingWoffFile: null,    // File object (original .woff)
    glyphs: [],                // unified: { id, name, codepoint, svgContent, originalSvgContent, svgPathData, isNew, file, unitsPerEm }
    generatedBlob: null,
    fontName: 'CustomFont',
    codepointStart: 0xE001,
    cssPrefix: sessionStorage.getItem('woff_cssPrefix') || 'icon',
    cssPreviewText: null,      // cached CSS preview text (invalidated on changes)
    normWidth: 28,
    normHeight: 28,
    normAlignH: 'center',
    normAlignV: 'center',
    searchQuery: '',           // current search/filter text
    channelId: new URL(window.location.href).searchParams.get('channel') || new URL(window.location.href).searchParams.get('chanel') || null,
    socketConnected: false,
    theme: localStorage.getItem('woff_theme') || 'system',
  };

  function nextId() { return ++_idCounter; }

  // ── DOM Refs ───────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const startSection = $('#startSection');
  const workspaceSection = $('#workspaceSection');
  const woffDropZone = $('#woffDropZone');
  const btnBrowseWoff = $('#btnBrowseWoff');
  const btnCreateNew = $('#btnCreateNew');
  const btnBackToStart = $('#btnBackToStart');
  const woffInput = $('#woffInput');
  const svgInput = $('#svgInput');
  const btnBrowseSvg = $('#btnBrowseSvg');
  const dropZone = $('#dropZone');
  const fontNameInput = $('#fontNameInput');
  const fontNameDisplay = $('#fontNameDisplay');
  const glyphCountBadge = $('#glyphCountBadge');
  const glyphListWrapper = $('#glyphListWrapper');
  const glyphList = $('#glyphList');
  const generateActions = $('#generateActions');
  const btnGenerate = $('#btnGenerate');
  const btnExportCss = $('#btnExportCss');
  const statusBar = $('#statusBar');
  const statusText = $('#statusText');
  const errorBar = $('#errorBar');
  const errorText = $('#errorText');
  const btnDismissError = $('#btnDismissError');
  const downloadSection = $('#downloadSection');
  const downloadFileName = $('#downloadFileName');
  const downloadFileSize = $('#downloadFileSize');
  const btnDownload = $('#btnDownload');
  const btnDownloadCss = $('#btnDownloadCss');
  const codepointStartInput = $('#codepointStartInput');
  const cssPrefixInput = $('#cssPrefixInput');
  const btnSortAZ = $('#btnSortAZ');
  const btnReindex = $('#btnReindex');
  const glyphToolbar = $('#glyphToolbar');
  const cssConfigSection = $('#cssConfigSection');
  const cssPreviewSection = $('#cssPreviewSection');
  const cssPreviewCode = $('#cssPreviewCode');
  const btnPreviewCss = $('#btnPreviewCss');
  const btnCopyCss = $('#btnCopyCss');
  const normPanel = $('#normPanel');
  const normWidthInput = $('#normWidth');
  const normHeightInput = $('#normHeight');
  const normAlignHSelect = $('#normAlignH');
  const normAlignVSelect = $('#normAlignV');
  const btnNormalizeAll = $('#btnNormalizeAll');
  const searchWrapper = $('#searchWrapper');
  const searchInput = $('#searchInput');
  const btnClearSearch = $('#btnClearSearch');
  const searchResultCount = $('#searchResultCount');
  const themeToggle = $('#themeToggle');
  const themeToggleLabel = $('#themeToggleLabel');
  const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');

  // ── Helpers ────────────────────────────────────────────
  function show(el) { if (el) el.classList.remove('hidden'); }
  function hide(el) { if (el) el.classList.add('hidden'); }

  function showError(msg) {
    errorText.textContent = msg;
    show(errorBar);
  }

  function hideError() { hide(errorBar); }

  function getEffectiveTheme() {
    return state.theme === 'system' ? (systemThemeQuery.matches ? 'dark' : 'light') : state.theme;
  }

  function applyTheme() {
    const effectiveTheme = getEffectiveTheme();

    if (state.theme === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.dataset.theme = state.theme;
    }

    if (themeToggle) {
      themeToggle.setAttribute('aria-pressed', String(effectiveTheme === 'dark'));
      themeToggle.setAttribute('aria-label', effectiveTheme === 'dark' ? 'Use light mode' : 'Use dark mode');
    }

    if (themeToggleLabel) {
      themeToggleLabel.textContent = state.theme === 'system' ? 'System' : (state.theme === 'dark' ? 'Dark' : 'Light');
    }
  }

  function cycleTheme() {
    state.theme = state.theme === 'system' ? 'dark' : state.theme === 'dark' ? 'light' : 'system';
    localStorage.setItem('woff_theme', state.theme);
    applyTheme();
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function sanitizeName(filename) {
    return filename.replace(/\.svg$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+|_+$/g, '') || 'glyph';
  }

  function codepointToHex(cp) {
    return cp ? cp.toString(16).toUpperCase().padStart(4, '0') : '----';
  }

  function codepointToCssEscape(cp) {
    return cp ? `\\${cp.toString(16).toLowerCase()}` : '';
  }

  /** Invalidate the cached CSS preview so the user knows it needs a refresh. */
  function invalidateCssPreview() {
    state.cssPreviewText = null;
    if (cssPreviewCode) {
      cssPreviewCode.innerHTML = '<code>/* Preview outdated — click "Preview CSS" to refresh */</code>';
      cssPreviewCode.classList.add('css-preview__code--stale');
    }
  }

  // ── Navigation ─────────────────────────────────────────
  function goToStart() {
    state.mode = 'start';
    state.existingWoffFile = null;
    state.glyphs = [];
    state.generatedBlob = null;
    state.fontName = 'CustomFont';
    state.cssPreviewText = null;
    fontNameInput.value = 'CustomFont';

    show(startSection);
    hide(workspaceSection);
    hide(errorBar);
    hide(statusBar);
    hide(downloadSection);
  }

  function goToWorkspace(fontName, existingGlyphs) {
    state.mode = 'workspace';
    state.fontName = fontName || 'CustomFont';
    state.generatedBlob = null;
    state.cssPreviewText = null;

    // Convert existing glyphs into unified format
    if (existingGlyphs && existingGlyphs.length > 0) {
      state.glyphs = existingGlyphs.map(g => ({
        id: nextId(),
        name: g.name || `glyph_${g.index}`,
        codepoint: g.unicode || null,
        svgContent: g.svgPathData ? buildSvgFromPath(g.svgPathData, g.unitsPerEm || 1000) : null,
        svgPathData: g.svgPathData,
        isNew: false,
        file: null,
        unitsPerEm: g.unitsPerEm || 1000,
      })).filter(g => g.svgContent || g.svgPathData);
    }

    fontNameInput.value = state.fontName;
    fontNameDisplay.textContent = state.fontName;
    codepointStartInput.value = state.codepointStart.toString(16).toUpperCase();
    cssPrefixInput.value = state.cssPrefix;
    state.searchQuery = '';
    if (searchInput) searchInput.value = '';

    hide(startSection);
    show(workspaceSection);
    hide(errorBar);
    hide(statusBar);
    hide(downloadSection);

    // Auto re-index if there are glyphs without codepoints
    if (state.glyphs.some(g => !g.codepoint)) {
      reindexGlyphs();
    }

    renderGlyphList();
  }

  function buildSvgFromPath(pathData, unitsPerEm) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${unitsPerEm} ${unitsPerEm}" fill="currentColor"><path d="${pathData}"/></svg>`;
  }

  // ── Glyph Management ──────────────────────────────────

  function reindexGlyphs() {
    const startHex = codepointStartInput.value.trim();
    let start = parseInt(startHex, 16);
    if (isNaN(start) || start < 0x20) start = 0xE001;
    state.codepointStart = start;

    state.glyphs.forEach((g, i) => {
      g.codepoint = start + i;
    });

    invalidateCssPreview();
  }

  function sortGlyphsAZ() {
    state.glyphs.sort((a, b) => a.name.localeCompare(b.name));
    reindexGlyphs();
    renderGlyphList();
  }

  function handleReindex() {
    reindexGlyphs();
    renderGlyphList();
  }

  // ── Drag-and-Drop Reorder ─────────────────────────────
  let dragSrcIndex = null;

  function handleDragStart(e, index) {
    dragSrcIndex = index;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index);
    // Delay adding class so the drag image captures before transparency
    setTimeout(() => e.target.classList.add('glyph-card--dragging'), 0);
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const card = e.target.closest('.glyph-card');
    if (card) card.classList.add('glyph-card--dragover');
  }

  function handleDragLeave(e) {
    const card = e.target.closest('.glyph-card');
    if (card) card.classList.remove('glyph-card--dragover');
  }

  function handleDrop(e, targetIndex) {
    e.preventDefault();
    const card = e.target.closest('.glyph-card');
    if (card) card.classList.remove('glyph-card--dragover');

    if (dragSrcIndex === null || dragSrcIndex === targetIndex) return;

    // Move the glyph in the array
    const [moved] = state.glyphs.splice(dragSrcIndex, 1);
    state.glyphs.splice(targetIndex, 0, moved);
    dragSrcIndex = null;

    reindexGlyphs();
    renderGlyphList();
  }

  function handleDragEnd(e) {
    e.target.classList.remove('glyph-card--dragging');
    dragSrcIndex = null;
    // Clean up any lingering dragover classes
    document.querySelectorAll('.glyph-card--dragover').forEach(el => el.classList.remove('glyph-card--dragover'));
  }

  // ── Glyph List Rendering ──────────────────────────────
  function renderGlyphList() {
    const totalCount = state.glyphs.length;
    glyphCountBadge.textContent = totalCount + ' glyph' + (totalCount !== 1 ? 's' : '');
    fontNameDisplay.textContent = fontNameInput.value || state.fontName;

    if (totalCount === 0) {
      hide(glyphListWrapper);
      hide(generateActions);
      hide(glyphToolbar);
      hide(normPanel);
      hide(searchWrapper);
      hide(cssConfigSection);
      hide(cssPreviewSection);
      return;
    }

    show(glyphListWrapper);
    show(generateActions);
    show(glyphToolbar);
    show(normPanel);
    show(searchWrapper);
    show(cssConfigSection);
    show(cssPreviewSection);

    glyphList.innerHTML = '';

    const query = state.searchQuery.toLowerCase().trim();
    let visibleCount = 0;

    state.glyphs.forEach((g, i) => {
      const matches = !query || g.name.toLowerCase().includes(query);
      const card = createGlyphCard(g, i);
      if (!matches) {
        card.style.display = 'none';
      } else {
        visibleCount++;
      }
      glyphList.appendChild(card);
    });

    // Update search result count
    if (query) {
      searchResultCount.innerHTML = `<strong>${visibleCount}</strong> of ${totalCount} icon${totalCount !== 1 ? 's' : ''}`;
      show(searchResultCount);
    } else {
      hide(searchResultCount);
    }
  }

  function createGlyphCard(glyph, index) {
    const prefix = cssPrefixInput.value.trim() || 'icon';

    const card = document.createElement('div');
    card.className = 'glyph-card' + (glyph.isNew ? '' : ' glyph-card--existing');
    card.draggable = true;
    card.dataset.index = index;

    // Drag events
    card.addEventListener('dragstart', (e) => handleDragStart(e, index));
    card.addEventListener('dragover', handleDragOver);
    card.addEventListener('dragleave', handleDragLeave);
    card.addEventListener('drop', (e) => handleDrop(e, index));
    card.addEventListener('dragend', handleDragEnd);

    // Index badge
    const indexBadge = document.createElement('div');
    indexBadge.className = 'glyph-card__index';
    indexBadge.textContent = '#' + index;

    // Preview
    const preview = document.createElement('div');
    preview.className = 'glyph-card__preview';
    if (glyph.svgContent) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(glyph.svgContent, 'image/svg+xml');
      const svg = doc.querySelector('svg');
      if (svg) {
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        svg.style.width = '100%';
        svg.style.height = '100%';
        // Ensure visibility on dark background
        if (!svg.getAttribute('fill') || svg.getAttribute('fill') === 'none') {
          svg.setAttribute('fill', 'currentColor');
        }
        preview.appendChild(svg);
      }
    } else if (glyph.svgPathData) {
      const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svgEl.setAttribute('viewBox', '0 0 1000 1000');
      svgEl.setAttribute('fill', 'currentColor');
      const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathEl.setAttribute('d', glyph.svgPathData);
      svgEl.appendChild(pathEl);
      preview.appendChild(svgEl);
    } else {
      preview.textContent = '?';
    }

    // Editable Name (with edit hint)
    const nameRow = document.createElement('div');
    nameRow.className = 'glyph-card__name-row';

    const nameEl = document.createElement('div');
    nameEl.className = 'glyph-card__name';
    nameEl.textContent = glyph.name;
    nameEl.title = 'Click to rename';

    const editHint = document.createElement('span');
    editHint.className = 'glyph-card__edit-hint';
    editHint.textContent = '✎';
    editHint.title = 'Rename';

    nameRow.appendChild(nameEl);
    nameRow.appendChild(editHint);

    const handleRenameClick = (e) => {
      e.stopPropagation();
      startInlineRename(nameEl, glyph);
    };
    nameEl.addEventListener('click', handleRenameClick);
    editHint.addEventListener('click', handleRenameClick);

    // Unicode
    const uniEl = document.createElement('div');
    uniEl.className = 'glyph-card__unicode';
    uniEl.textContent = glyph.codepoint ? ('U+' + codepointToHex(glyph.codepoint)) : '----';

    // CSS content escape preview
    const cssContentEl = document.createElement('div');
    cssContentEl.className = 'glyph-card__css-content';
    cssContentEl.textContent = glyph.codepoint ? `content: '${codepointToCssEscape(glyph.codepoint)}'` : '';

    // CSS selector preview
    const cssSelectorEl = document.createElement('div');
    cssSelectorEl.className = 'glyph-card__css-selector';
    cssSelectorEl.textContent = `.${prefix}-${glyph.name}`;

    // Normalize button (per-glyph)
    const normBtn = document.createElement('button');
    normBtn.className = 'glyph-card__normalize';
    normBtn.innerHTML = '⊞';
    normBtn.title = 'Normalize this icon';
    normBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      normalizeOne(glyph);
    });

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'glyph-card__remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove glyph';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.glyphs.splice(index, 1);
      reindexGlyphs();
      renderGlyphList();
    });

    // Drag handle indicator
    const dragHandle = document.createElement('div');
    dragHandle.className = 'glyph-card__drag-handle';
    dragHandle.innerHTML = '⠿';
    dragHandle.title = 'Drag to reorder';

    card.append(dragHandle, indexBadge, preview, nameRow, uniEl, cssContentEl, cssSelectorEl, normBtn, removeBtn);
    return card;
  }

  // ── Inline Rename ─────────────────────────────────────
  function startInlineRename(nameEl, glyph) {
    const currentName = glyph.name;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'glyph-card__name-input';
    input.value = currentName;
    input.maxLength = 64;

    nameEl.textContent = '';
    nameEl.appendChild(input);
    input.focus();
    input.select();

    function commit() {
      const newName = input.value.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || currentName;
      glyph.name = newName;
      nameEl.textContent = newName;
      if (newName !== currentName) {
        invalidateCssPreview();
      }
    }

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { input.blur(); }
      if (e.key === 'Escape') { input.value = currentName; input.blur(); }
    });
  }

  // ── Client-Side SVG Normalization ──────────────────────

  /**
   * Normalize an SVG string client-side.
   * Same algorithm as lib/normalize-svg.js but runs in the browser.
   */
  function normalizeSvgClient(svgContent, targetWidth, targetHeight, alignH, alignV) {
    if (!svgContent) return { error: 'No SVG content.' };

    // Check for data-original-viewbox (set by prior normalization)
    const origAttrMatch = svgContent.match(/data-original-viewbox="([^"]*)"/);
    let sourceVB = null;

    if (origAttrMatch) {
      const parts = origAttrMatch[1].split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts.every(n => !isNaN(n))) {
        sourceVB = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
      }
    }

    if (!sourceVB) {
      const vbMatch = svgContent.match(/viewBox="([^"]*)"/i);
      if (vbMatch) {
        const parts = vbMatch[1].split(/[\s,]+/).map(Number);
        if (parts.length === 4 && parts.every(n => !isNaN(n))) {
          sourceVB = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
        }
      }
    }

    if (!sourceVB) {
      const wMatch = svgContent.match(/\bwidth="([^"]*)"/i);
      const hMatch = svgContent.match(/\bheight="([^"]*)"/i);
      if (wMatch && hMatch) {
        const w = parseFloat(wMatch[1]);
        const h = parseFloat(hMatch[1]);
        if (w > 0 && h > 0) sourceVB = { x: 0, y: 0, w, h };
      }
    }

    if (!sourceVB) sourceVB = { x: 0, y: 0, w: 1000, h: 1000 };
    if (sourceVB.w <= 0 || sourceVB.h <= 0) return { error: 'Source SVG has zero dimensions.' };

    const scaleX = targetWidth / sourceVB.w;
    const scaleY = targetHeight / sourceVB.h;
    const scale = Math.min(scaleX, scaleY);
    const scaledW = sourceVB.w * scale;
    const scaledH = sourceVB.h * scale;

    let tx = 0, ty = 0;
    if (alignH === 'right') tx = targetWidth - scaledW;
    else if (alignH === 'center') tx = (targetWidth - scaledW) / 2;
    if (alignV === 'bottom') ty = targetHeight - scaledH;
    else if (alignV === 'center') ty = (targetHeight - scaledH) / 2;

    tx += -sourceVB.x * scale;
    ty += -sourceVB.y * scale;

    // Extract inner content
    let inner = svgContent.replace(/<svg[^>]*>/i, '').replace(/<\/svg>\s*$/i, '').trim();
    const wrapperMatch = inner.match(/<g data-norm-wrapper="true"[^>]*>([\s\S]*)<\/g>/i);
    if (wrapperMatch) inner = wrapperMatch[1].trim();

    const originalVB = origAttrMatch
      ? origAttrMatch[1]
      : `${sourceVB.x} ${sourceVB.y} ${sourceVB.w} ${sourceVB.h}`;

    const r = (n) => Math.round(n * 10000) / 10000;
    const transform = `translate(${r(tx)}, ${r(ty)}) scale(${r(scale)})`;

    return {
      normalizedSvg: [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${targetWidth} ${targetHeight}" data-original-viewbox="${originalVB}" fill="currentColor">`,
        `  <g data-norm-wrapper="true" transform="${transform}">`,
        `    ${inner}`,
        `  </g>`,
        `</svg>`,
      ].join('\n'),
    };
  }

  /** Read current normalization settings from UI inputs. */
  function getNormSettings() {
    return {
      targetWidth: parseInt(normWidthInput.value, 10) || 28,
      targetHeight: parseInt(normHeightInput.value, 10) || 28,
      alignH: normAlignHSelect.value || 'center',
      alignV: normAlignVSelect.value || 'center',
    };
  }

  /** Normalize a single glyph. */
  function normalizeOne(glyph) {
    hideError();
    const { targetWidth, targetHeight, alignH, alignV } = getNormSettings();

    // Preserve original source on first normalization
    if (!glyph.originalSvgContent) {
      glyph.originalSvgContent = glyph.svgContent;
    }

    // Always normalize from the original source
    const source = glyph.originalSvgContent || glyph.svgContent;
    if (!source) {
      showError(`Cannot normalize "${glyph.name}": no SVG content available.`);
      return;
    }

    const result = normalizeSvgClient(source, targetWidth, targetHeight, alignH, alignV);
    if (result.error) {
      showError(`Normalization failed for "${glyph.name}": ${result.error}`);
      return;
    }

    glyph.svgContent = result.normalizedSvg;
    invalidateCssPreview();
    renderGlyphList();
  }

  /** Normalize all glyphs using current preset. */
  function normalizeAll() {
    hideError();
    const { targetWidth, targetHeight, alignH, alignV } = getNormSettings();
    const errors = [];

    for (const glyph of state.glyphs) {
      if (!glyph.originalSvgContent) {
        glyph.originalSvgContent = glyph.svgContent;
      }
      const source = glyph.originalSvgContent || glyph.svgContent;
      if (!source) {
        errors.push(`"${glyph.name}": no SVG content available.`);
        continue;
      }
      const result = normalizeSvgClient(source, targetWidth, targetHeight, alignH, alignV);
      if (result.error) {
        errors.push(`"${glyph.name}": ${result.error}`);
        continue;
      }
      glyph.svgContent = result.normalizedSvg;
    }

    if (errors.length > 0) {
      showError('Some icons could not be normalized:\n' + errors.join('\n'));
    }

    invalidateCssPreview();
    renderGlyphList();
  }

  // ── File Handling ───────────────────────────────────────

  async function handleWoffOpen(file) {
    if (!file.name.toLowerCase().endsWith('.woff')) {
      showError('Only .woff files are accepted. Please select a valid .woff file.');
      return;
    }

    hideError();
    show(statusBar);
    statusText.textContent = 'Parsing .woff file...';

    try {
      const formData = new FormData();
      formData.append('woffFile', file);

      const res = await fetch('/api/parse-woff', { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to parse .woff file.');
      }

      state.existingWoffFile = file;

      // Pass parsed data with unitsPerEm
      const glyphsWithUPE = (data.glyphs || []).map(g => ({
        ...g,
        unitsPerEm: data.unitsPerEm || 1000,
      }));

      hide(statusBar);
      goToWorkspace(data.fontFamily, glyphsWithUPE);
    } catch (err) {
      hide(statusBar);
      showError(err.message);
    }
  }

  async function handleSvgFiles(files) {
    hideError();
    const errors = [];

    for (const file of files) {
      if (!file.name.toLowerCase().endsWith('.svg')) {
        errors.push(`"${file.name}" is not an .svg file — skipped.`);
        continue;
      }

      try {
        const content = await file.text();
        if (!content.includes('<svg') && !content.includes('<SVG')) {
          errors.push(`"${file.name}" is not a valid SVG file — skipped.`);
          continue;
        }

        state.glyphs.push({
          id: nextId(),
          name: sanitizeName(file.name),
          codepoint: null,
          svgContent: content,
          originalSvgContent: content,
          svgPathData: null,
          isNew: true,
          file,
        });
      } catch (err) {
        errors.push(`Failed to read "${file.name}": ${err.message}`);
      }
    }

    if (errors.length > 0) {
      showError(errors.join('\n'));
    }

    // Auto re-index after adding
    reindexGlyphs();
    renderGlyphList();
  }

  // ── Generation ──────────────────────────────────────────
  async function handleGenerate() {
    hideError();
    hide(downloadSection);
    show(statusBar);
    statusText.textContent = 'Generating .woff file...';
    btnGenerate.disabled = true;

    try {
      if (state.glyphs.length === 0) {
        throw new Error('No glyphs to generate. Please add at least one SVG file.');
      }

      // Build glyphMeta with full SVG content
      const glyphMeta = state.glyphs.map(g => ({
        name: g.name,
        codepoint: g.codepoint,
        svgContent: g.svgContent,
      }));

      const formData = new FormData();
      formData.append('fontName', fontNameInput.value || state.fontName);
      formData.append('glyphMeta', JSON.stringify(glyphMeta));

      const res = await fetch('/api/generate', { method: 'POST', body: formData });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Generation failed.');
      }

      const blob = await res.blob();
      state.generatedBlob = blob;

      hide(statusBar);

      // Show download
      const fname = (fontNameInput.value || state.fontName) + '.woff';
      downloadFileName.textContent = fname;
      downloadFileSize.textContent = formatBytes(blob.size);
      show(downloadSection);

    } catch (err) {
      hide(statusBar);
      showError(err.message);
    } finally {
      btnGenerate.disabled = false;
    }
  }

  function handleDownload() {
    if (!state.generatedBlob) return;
    const defaultName = (fontNameInput.value || state.fontName) + '.woff';
    const fileName = prompt('Save as:', defaultName);
    if (!fileName) return; // user cancelled
    const url = URL.createObjectURL(state.generatedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.endsWith('.woff') ? fileName : fileName + '.woff';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── CSS Export & Preview ───────────────────────────────

  /** Fetch generated CSS text from the server. */
  async function fetchGeneratedCss() {
    const prefix = cssPrefixInput.value.trim() || 'icon';
    const fontFamily = fontNameInput.value.trim() || state.fontName;
    const fontPath = `fonts/${fontFamily}.woff`;

    const res = await fetch('/api/generate-css', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fontFamily,
        prefix,
        fontPath,
        glyphs: state.glyphs.map(g => ({
          name: g.name,
          codepoint: g.codepoint,
        })),
      }),
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'CSS generation failed.');
    }

    return res.text();
  }

  /** Download a CSS text string as a .css file. */
  function downloadCss(cssText, fontFamily) {
    const blob = new Blob([cssText], { type: 'text/css' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fontFamily}.css`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** Preview CSS in the on-page panel. */
  async function handlePreviewCss() {
    hideError();

    if (state.glyphs.length === 0) {
      showError('No glyphs to preview. Please add at least one glyph.');
      return;
    }

    try {
      btnPreviewCss.disabled = true;
      btnPreviewCss.textContent = 'Generating...';

      const cssText = await fetchGeneratedCss();
      state.cssPreviewText = cssText;

      // Render into the preview panel
      cssPreviewCode.classList.remove('css-preview__code--stale');
      cssPreviewCode.innerHTML = '';
      const codeEl = document.createElement('code');
      codeEl.textContent = cssText;
      cssPreviewCode.appendChild(codeEl);

    } catch (err) {
      showError(err.message);
    } finally {
      btnPreviewCss.disabled = false;
      btnPreviewCss.innerHTML = `<svg class="btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg> Preview CSS`;
    }
  }

  /** Download CSS — reuse cached preview if available, otherwise fetch. */
  async function handleExportCss() {
    hideError();

    if (state.glyphs.length === 0) {
      showError('No glyphs to export. Please add at least one glyph.');
      return;
    }

    try {
      const fontFamily = fontNameInput.value.trim() || state.fontName;
      let cssText = state.cssPreviewText;

      // If no cached preview, fetch fresh
      if (!cssText) {
        cssText = await fetchGeneratedCss();
        state.cssPreviewText = cssText;
      }

      downloadCss(cssText, fontFamily);
    } catch (err) {
      showError(err.message);
    }
  }

  /** Copy CSS to clipboard. */
  async function handleCopyCss() {
    if (!state.cssPreviewText) {
      // Generate first
      await handlePreviewCss();
    }

    if (state.cssPreviewText) {
      try {
        await navigator.clipboard.writeText(state.cssPreviewText);
        const originalText = btnCopyCss.textContent;
        btnCopyCss.textContent = '✓ Copied!';
        setTimeout(() => {
          btnCopyCss.innerHTML = `<svg class="btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
          </svg> Copy`;
        }, 1500);
      } catch (err) {
        showError('Failed to copy: ' + err.message);
      }
    }
  }

  // ── Event Listeners ────────────────────────────────────

  applyTheme();
  if (themeToggle) themeToggle.addEventListener('click', cycleTheme);
  if (systemThemeQuery.addEventListener) {
    systemThemeQuery.addEventListener('change', applyTheme);
  } else if (systemThemeQuery.addListener) {
    systemThemeQuery.addListener(applyTheme);
  }

  // Start mode — WOFF drop zone
  btnBrowseWoff.addEventListener('click', (e) => {
    e.stopPropagation();
    woffInput.click();
  });
  woffDropZone.addEventListener('click', (e) => {
    if (e.target === btnBrowseWoff) return;
    woffInput.click();
  });
  woffDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    woffDropZone.classList.add('woff-drop-zone--active');
  });
  woffDropZone.addEventListener('dragleave', () => {
    woffDropZone.classList.remove('woff-drop-zone--active');
  });
  woffDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    woffDropZone.classList.remove('woff-drop-zone--active');
    const file = Array.from(e.dataTransfer.files).find(f => f.name.toLowerCase().endsWith('.woff'));
    if (file) {
      handleWoffOpen(file);
    }
  });
  woffInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleWoffOpen(e.target.files[0]);
    woffInput.value = '';
  });

  btnCreateNew.addEventListener('click', () => goToWorkspace('CustomFont', []));
  btnBackToStart.addEventListener('click', goToStart);

  // SVG upload
  btnBrowseSvg.addEventListener('click', (e) => {
    e.preventDefault();
    svgInput.click();
  });
  dropZone.addEventListener('click', (e) => {
    if (e.target === btnBrowseSvg) return;
    svgInput.click();
  });
  svgInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleSvgFiles(Array.from(e.target.files));
    svgInput.value = '';
  });

  // Drag & drop zone
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drop-zone--active');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drop-zone--active');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drop-zone--active');
    if (e.dataTransfer.files.length > 0) {
      handleSvgFiles(Array.from(e.dataTransfer.files));
    }
  });

  // Font name live update
  fontNameInput.addEventListener('input', () => {
    fontNameDisplay.textContent = fontNameInput.value || 'CustomFont';
    state.fontName = fontNameInput.value || 'CustomFont';
    invalidateCssPreview();
  });

  // Toolbar: Sort, Re-index
  if (btnSortAZ) btnSortAZ.addEventListener('click', sortGlyphsAZ);
  if (btnReindex) btnReindex.addEventListener('click', handleReindex);
  if (codepointStartInput) {
    codepointStartInput.addEventListener('change', () => {
      const val = parseInt(codepointStartInput.value.trim(), 16);
      if (!isNaN(val) && val >= 0x20) {
        state.codepointStart = val;
      }
    });
  }
  if (cssPrefixInput) {
    cssPrefixInput.addEventListener('input', () => {
      state.cssPrefix = cssPrefixInput.value.trim() || 'icon';
      sessionStorage.setItem('woff_cssPrefix', state.cssPrefix);
      invalidateCssPreview();
    });
  }

  // Search filtering
  if (searchInput) {
    let searchDebounce = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        state.searchQuery = searchInput.value;
        if (searchInput.value) {
          show(btnClearSearch);
        } else {
          hide(btnClearSearch);
        }
        renderGlyphList();
      }, 150);
    });
  }
  if (btnClearSearch) {
    btnClearSearch.addEventListener('click', () => {
      searchInput.value = '';
      state.searchQuery = '';
      hide(btnClearSearch);
      renderGlyphList();
      searchInput.focus();
    });
  }

  // Normalization
  if (btnNormalizeAll) btnNormalizeAll.addEventListener('click', normalizeAll);

  // CSS Preview & Copy
  if (btnPreviewCss) btnPreviewCss.addEventListener('click', handlePreviewCss);
  if (btnCopyCss) btnCopyCss.addEventListener('click', handleCopyCss);

  // Generate & Export
  btnGenerate.addEventListener('click', handleGenerate);
  if (btnExportCss) btnExportCss.addEventListener('click', handleExportCss);

  // Download
  btnDownload.addEventListener('click', handleDownload);
  if (btnDownloadCss) btnDownloadCss.addEventListener('click', handleExportCss);

  // Dismiss error
  btnDismissError.addEventListener('click', hideError);

})();
