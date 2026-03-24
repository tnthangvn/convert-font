/* ── WOFF Tool — App Logic ─────────────────────────────── */
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────
  const state = {
    mode: 'start', // 'start' | 'workspace'
    existingWoffFile: null,    // File object (original .woff)
    existingGlyphs: [],        // parsed glyphs from existing .woff
    newSvgFiles: [],           // { file: File, name: string, svgContent: string }
    generatedBlob: null,
    fontName: 'CustomFont',
  };

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
  const statusBar = $('#statusBar');
  const statusText = $('#statusText');
  const errorBar = $('#errorBar');
  const errorText = $('#errorText');
  const btnDismissError = $('#btnDismissError');
  const downloadSection = $('#downloadSection');
  const downloadFileName = $('#downloadFileName');
  const downloadFileSize = $('#downloadFileSize');
  const btnDownload = $('#btnDownload');

  // ── Helpers ────────────────────────────────────────────
  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

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

  // ── Navigation ─────────────────────────────────────────
  function goToStart() {
    state.mode = 'start';
    state.existingWoffFile = null;
    state.existingGlyphs = [];
    state.newSvgFiles = [];
    state.generatedBlob = null;
    state.fontName = 'CustomFont';
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
    state.existingGlyphs = existingGlyphs || [];
    state.generatedBlob = null;

    fontNameInput.value = state.fontName;
    fontNameDisplay.textContent = state.fontName;

    hide(startSection);
    show(workspaceSection);
    hide(errorBar);
    hide(statusBar);
    hide(downloadSection);

    renderGlyphList();
  }

  // ── Glyph List Rendering ──────────────────────────────
  function renderGlyphList() {
    const totalCount = state.existingGlyphs.length + state.newSvgFiles.length;
    glyphCountBadge.textContent = totalCount + ' glyph' + (totalCount !== 1 ? 's' : '');
    fontNameDisplay.textContent = fontNameInput.value || state.fontName;

    if (totalCount === 0) {
      hide(glyphListWrapper);
      hide(generateActions);
      return;
    }

    show(glyphListWrapper);
    show(generateActions);

    glyphList.innerHTML = '';

    // Existing glyphs (from opened .woff)
    state.existingGlyphs.forEach((g, i) => {
      const card = createGlyphCard({
        name: g.name,
        unicode: g.unicodeHex,
        svgPathData: g.svgPathData,
        isExisting: true,
        onRemove: () => {
          state.existingGlyphs.splice(i, 1);
          renderGlyphList();
        },
      });
      glyphList.appendChild(card);
    });

    // New SVGs
    state.newSvgFiles.forEach((item, i) => {
      const card = createGlyphCard({
        name: item.name,
        unicode: null,
        svgContent: item.svgContent,
        isExisting: false,
        onRemove: () => {
          state.newSvgFiles.splice(i, 1);
          renderGlyphList();
        },
      });
      glyphList.appendChild(card);
    });
  }

  function createGlyphCard({ name, unicode, svgPathData, svgContent, isExisting, onRemove }) {
    const card = document.createElement('div');
    card.className = 'glyph-card' + (isExisting ? ' glyph-card--existing' : '');

    // Preview
    const preview = document.createElement('div');
    preview.className = 'glyph-card__preview';
    if (svgContent) {
      // Use the raw SVG content for new files
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgContent, 'image/svg+xml');
      const svg = doc.querySelector('svg');
      if (svg) {
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        svg.style.width = '100%';
        svg.style.height = '100%';
        preview.appendChild(svg);
      }
    } else if (svgPathData) {
      // Generate SVG from path data for existing glyphs
      const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svgEl.setAttribute('viewBox', '0 0 1000 1000');
      svgEl.setAttribute('fill', 'currentColor');
      const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathEl.setAttribute('d', svgPathData);
      svgEl.appendChild(pathEl);
      preview.appendChild(svgEl);
    } else {
      preview.textContent = '?';
    }

    // Name
    const nameEl = document.createElement('div');
    nameEl.className = 'glyph-card__name';
    nameEl.textContent = name;

    // Unicode
    const uniEl = document.createElement('div');
    uniEl.className = 'glyph-card__unicode';
    uniEl.textContent = unicode || '(new)';

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'glyph-card__remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove glyph';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onRemove();
    });

    card.append(preview, nameEl, uniEl, removeBtn);
    return card;
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
      hide(statusBar);
      goToWorkspace(data.fontFamily, data.glyphs);
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

        state.newSvgFiles.push({
          file,
          name: sanitizeName(file.name),
          svgContent: content,
        });
      } catch (err) {
        errors.push(`Failed to read "${file.name}": ${err.message}`);
      }
    }

    if (errors.length > 0) {
      showError(errors.join('\n'));
    }

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
      const formData = new FormData();
      formData.append('fontName', fontNameInput.value || state.fontName);

      // Attach existing woff if opened
      if (state.existingWoffFile) {
        formData.append('woffFile', state.existingWoffFile);
      }

      // Attach SVG files
      if (state.newSvgFiles.length === 0 && state.existingGlyphs.length === 0) {
        throw new Error('No glyphs to generate. Please add at least one SVG file.');
      }

      for (const item of state.newSvgFiles) {
        formData.append('svgFiles', item.file);
      }

      // If only existing glyphs and no new SVGs, we still need at least one SVG
      // Create a dummy SVG from existing glyph paths for re-generation
      if (state.newSvgFiles.length === 0 && state.existingGlyphs.length > 0 && !state.existingWoffFile) {
        throw new Error('Please add at least one new SVG file to generate a font.');
      }

      const res = await fetch('/api/generate', { method: 'POST', body: formData });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Generation failed.');
      }

      const blob = await res.blob();
      state.generatedBlob = blob;

      // Check for warnings
      const warnings = res.headers.get('X-Warnings');
      if (warnings) {
        try {
          const warnArr = JSON.parse(warnings);
          if (warnArr.length > 0) {
            showError('⚠ Some files had issues:\n' + warnArr.join('\n'));
          }
        } catch (_) { /* ignore */ }
      }

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

  // Drag & drop
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
  });

  // Generate
  btnGenerate.addEventListener('click', handleGenerate);

  // Download
  btnDownload.addEventListener('click', handleDownload);

  // Dismiss error
  btnDismissError.addEventListener('click', hideError);

})();
