/* ── WOFF Tool — App Logic ─────────────────────────────── */
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────
  let _idCounter = 0;
  const state = {
    mode: 'start', // 'start' | 'workspace'
    existingWoffFile: null,    // File object (original .woff)
    glyphs: [],                // unified: { id, name, codepoint, svgContent, svgPathData, isNew, file, unitsPerEm }
    generatedBlob: null,
    fontName: 'CustomFont',
    codepointStart: 0xE001,
    cssPrefix: 'icon',
    cssPreviewText: null,      // cached CSS preview text (invalidated on changes)
  };

  function nextId() { return ++_idCounter; }

  // ── DOM Refs ───────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const startSection = $('#startSection');
  const workspaceSection = $('#workspaceSection');
  const btnOpenWoff = $('#btnOpenWoff');
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

  // ── Helpers ────────────────────────────────────────────
  function show(el) { if (el) el.classList.remove('hidden'); }
  function hide(el) { if (el) el.classList.add('hidden'); }

  function showError(msg) {
    errorText.textContent = msg;
    show(errorBar);
  }

  function hideError() { hide(errorBar); }

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
      hide(cssConfigSection);
      hide(cssPreviewSection);
      return;
    }

    show(glyphListWrapper);
    show(generateActions);
    show(glyphToolbar);
    show(cssConfigSection);
    show(cssPreviewSection);

    glyphList.innerHTML = '';

    state.glyphs.forEach((g, i) => {
      const card = createGlyphCard(g, i);
      glyphList.appendChild(card);
    });
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

    card.append(dragHandle, indexBadge, preview, nameRow, uniEl, cssContentEl, cssSelectorEl, removeBtn);
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
    const url = URL.createObjectURL(state.generatedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (fontNameInput.value || state.fontName) + '.woff';
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

  // Start mode
  btnOpenWoff.addEventListener('click', () => woffInput.click());
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
      invalidateCssPreview();
    });
  }

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
