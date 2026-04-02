'use strict';

/**
 * Normalize an SVG string to fit within a target width × height box
 * with configurable horizontal and vertical alignment.
 *
 * The algorithm:
 *  1. Parse the SVG to extract the source viewBox (or derive from width/height).
 *  2. If `data-original-viewbox` is present, use that as source to prevent
 *     compounding transforms on re-normalization.
 *  3. Compute a uniform scale to fit the source into the target box.
 *  4. Compute translation offsets based on alignment.
 *  5. Emit a new SVG with the target viewBox and a <g transform="..."> wrapper.
 *
 * @param {object} opts
 * @param {string} opts.svgContent        — raw SVG markup
 * @param {number} opts.targetWidth       — target box width  (e.g. 28)
 * @param {number} opts.targetHeight      — target box height (e.g. 28)
 * @param {'left'|'center'|'right'}  opts.alignH — horizontal alignment
 * @param {'top'|'center'|'bottom'}  opts.alignV — vertical alignment
 * @returns {{ normalizedSvg: string } | { error: string }}
 */
function normalizeSvg({ svgContent, targetWidth = 28, targetHeight = 28, alignH = 'center', alignV = 'center' }) {
  if (!svgContent || typeof svgContent !== 'string') {
    return { error: 'No SVG content provided.' };
  }

  // ── Extract source viewBox ──────────────────────────────────

  // Check for data-original-viewbox first (set by a previous normalization)
  const origAttrMatch = svgContent.match(/data-original-viewbox="([^"]*)"/);
  let sourceViewBox = null;

  if (origAttrMatch) {
    const parts = origAttrMatch[1].split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(n => !isNaN(n))) {
      sourceViewBox = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
    }
  }

  if (!sourceViewBox) {
    // Try viewBox attribute
    const vbMatch = svgContent.match(/viewBox="([^"]*)"/i);
    if (vbMatch) {
      const parts = vbMatch[1].split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts.every(n => !isNaN(n))) {
        sourceViewBox = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
      }
    }
  }

  if (!sourceViewBox) {
    // Try width/height attributes
    const wMatch = svgContent.match(/\bwidth="([^"]*)"/i);
    const hMatch = svgContent.match(/\bheight="([^"]*)"/i);
    if (wMatch && hMatch) {
      const w = parseFloat(wMatch[1]);
      const h = parseFloat(hMatch[1]);
      if (w > 0 && h > 0) {
        sourceViewBox = { x: 0, y: 0, w, h };
      }
    }
  }

  if (!sourceViewBox) {
    // Default fallback (common font unitsPerEm)
    sourceViewBox = { x: 0, y: 0, w: 1000, h: 1000 };
  }

  // ── Validate ────────────────────────────────────────────────

  if (sourceViewBox.w <= 0 || sourceViewBox.h <= 0) {
    return { error: 'Source SVG has zero or negative dimensions — cannot normalize.' };
  }

  if (targetWidth <= 0 || targetHeight <= 0) {
    return { error: 'Target dimensions must be positive numbers.' };
  }

  // ── Compute transform ──────────────────────────────────────

  const scaleX = targetWidth / sourceViewBox.w;
  const scaleY = targetHeight / sourceViewBox.h;
  const scale = Math.min(scaleX, scaleY); // uniform scale preserving aspect ratio

  const scaledW = sourceViewBox.w * scale;
  const scaledH = sourceViewBox.h * scale;

  // Alignment offsets
  let tx = 0;
  let ty = 0;

  switch (alignH) {
    case 'left':   tx = 0; break;
    case 'right':  tx = targetWidth - scaledW; break;
    case 'center': // fall-through
    default:       tx = (targetWidth - scaledW) / 2; break;
  }

  switch (alignV) {
    case 'top':    ty = 0; break;
    case 'bottom': ty = targetHeight - scaledH; break;
    case 'center': // fall-through
    default:       ty = (targetHeight - scaledH) / 2; break;
  }

  // Offset for the source viewBox origin
  const originOffsetX = -sourceViewBox.x * scale;
  const originOffsetY = -sourceViewBox.y * scale;

  const finalTx = tx + originOffsetX;
  const finalTy = ty + originOffsetY;

  // ── Extract inner content ──────────────────────────────────

  // Remove the outer <svg ...> and </svg> tags to get inner content
  let innerContent = svgContent
    .replace(/<svg[^>]*>/i, '')
    .replace(/<\/svg>\s*$/i, '')
    .trim();

  // Remove any existing normalization <g> wrapper (identified by data-norm-wrapper)
  const normWrapperRegex = /<g data-norm-wrapper="true"[^>]*>([\s\S]*)<\/g>/i;
  const wrapperMatch = innerContent.match(normWrapperRegex);
  if (wrapperMatch) {
    innerContent = wrapperMatch[1].trim();
  }

  // ── Preserve original viewBox ──────────────────────────────

  // The original viewBox is the source BEFORE any normalization.
  // If data-original-viewbox was already present, keep it; otherwise store current source.
  const originalViewBox = origAttrMatch
    ? origAttrMatch[1]
    : `${sourceViewBox.x} ${sourceViewBox.y} ${sourceViewBox.w} ${sourceViewBox.h}`;

  // ── Build normalized SVG ───────────────────────────────────

  // Round to 4 decimal places for cleanliness
  const r = (n) => Math.round(n * 10000) / 10000;

  const transform = `translate(${r(finalTx)}, ${r(finalTy)}) scale(${r(scale)})`;

  const normalizedSvg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${targetWidth} ${targetHeight}" data-original-viewbox="${originalViewBox}" fill="currentColor">`,
    `  <g data-norm-wrapper="true" transform="${transform}">`,
    `    ${innerContent}`,
    `  </g>`,
    `</svg>`,
  ].join('\n');

  return { normalizedSvg };
}

module.exports = { normalizeSvg };
