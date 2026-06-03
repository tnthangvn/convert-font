'use strict';

/**
 * Vectorize an SVG into plain black-filled <path> elements.
 *
 * Why: svgicons2svgfont (and font glyphs in general) only render *filled paths*.
 * Icons built from primitive shapes (<rect>, <circle>, …) or from strokes
 * (outline / line icons like Lucide, Feather) would otherwise come out empty or
 * wrong. This module:
 *
 *   1. Converts every primitive shape to a path.
 *   2. Outlines every stroke into a filled path (so outline icons survive).
 *   3. Bakes element/group transforms into absolute coordinates (via svgpath).
 *   4. Emits each piece as `<path fill="#000" d="…"/>` — the icon-font standard.
 *
 * Stroke outlining is an approximation tuned for icon-font scale: strokes become
 * the union (non-zero winding) of per-segment quads plus round join/cap polygons.
 * Miter/bevel joins are rendered as round — imperceptible at glyph sizes.
 */

const svgpath = require('svgpath');

const CURVE_SAMPLES = 16; // subdivisions per bezier when flattening for stroke
const CIRCLE_SIDES = 24;  // polygon sides for round caps/joins

// ── number helpers ─────────────────────────────────────────────

const num = (v, d = 0) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

const round = (n) => Math.round(n * 1000) / 1000;

// ── shape → path `d` (in the element's local coordinates) ──────

function rectToPath(a) {
  const x = num(a.x), y = num(a.y);
  const w = num(a.width), h = num(a.height);
  if (w <= 0 || h <= 0) return null;
  let rx = a.rx != null ? num(a.rx) : (a.ry != null ? num(a.ry) : 0);
  let ry = a.ry != null ? num(a.ry) : (a.rx != null ? num(a.rx) : 0);
  rx = Math.min(rx, w / 2);
  ry = Math.min(ry, h / 2);
  if (rx <= 0 || ry <= 0) {
    return `M${x} ${y}h${w}v${h}h${-w}Z`;
  }
  return (
    `M${x + rx} ${y}` +
    `h${w - 2 * rx}` +
    `a${rx} ${ry} 0 0 1 ${rx} ${ry}` +
    `v${h - 2 * ry}` +
    `a${rx} ${ry} 0 0 1 ${-rx} ${ry}` +
    `h${-(w - 2 * rx)}` +
    `a${rx} ${ry} 0 0 1 ${-rx} ${-ry}` +
    `v${-(h - 2 * ry)}` +
    `a${rx} ${ry} 0 0 1 ${rx} ${-ry}Z`
  );
}

function circleToPath(a) {
  const cx = num(a.cx), cy = num(a.cy), r = num(a.r);
  if (r <= 0) return null;
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
}

function ellipseToPath(a) {
  const cx = num(a.cx), cy = num(a.cy), rx = num(a.rx), ry = num(a.ry);
  if (rx <= 0 || ry <= 0) return null;
  return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
}

function lineToPath(a) {
  return `M${num(a.x1)} ${num(a.y1)}L${num(a.x2)} ${num(a.y2)}`;
}

function pointsToPath(a, closed) {
  const nums = String(a.points || '').trim().split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
  if (nums.length < 4) return null;
  let d = `M${nums[0]} ${nums[1]}`;
  for (let i = 2; i + 1 < nums.length; i += 2) d += `L${nums[i]} ${nums[i + 1]}`;
  return closed ? d + 'Z' : d;
}

function shapeToPath(tag, attrs) {
  switch (tag) {
    case 'path': return attrs.d ? String(attrs.d) : null;
    case 'rect': return rectToPath(attrs);
    case 'circle': return circleToPath(attrs);
    case 'ellipse': return ellipseToPath(attrs);
    case 'line': return lineToPath(attrs);
    case 'polyline': return pointsToPath(attrs, false);
    case 'polygon': return pointsToPath(attrs, true);
    default: return null;
  }
}

// ── flatten a path `d` into polylines for stroking ─────────────

function sampleCubic(p0, p1, p2, p3, out) {
  for (let i = 1; i <= CURVE_SAMPLES; i++) {
    const t = i / CURVE_SAMPLES;
    const mt = 1 - t;
    const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
    out.push({ x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y });
  }
}

function sampleQuad(p0, p1, p2, out) {
  for (let i = 1; i <= CURVE_SAMPLES; i++) {
    const t = i / CURVE_SAMPLES;
    const mt = 1 - t;
    const a = mt * mt, b = 2 * mt * t, c = t * t;
    out.push({ x: a * p0.x + b * p1.x + c * p2.x, y: a * p0.y + b * p1.y + c * p2.y });
  }
}

/** @returns {Array<{points:Array<{x,y}>, closed:boolean}>} */
function flattenToPolylines(d) {
  const polylines = [];
  let cur = null;
  let startPt = null;

  svgpath(d).abs().unarc().unshort().iterate((seg, _i, x, y) => {
    const cmd = seg[0];
    const p0 = { x, y };
    if (cmd === 'M') {
      if (cur && cur.points.length > 1) polylines.push(cur);
      startPt = { x: seg[1], y: seg[2] };
      cur = { points: [{ ...startPt }], closed: false };
    } else if (cmd === 'L') {
      cur && cur.points.push({ x: seg[1], y: seg[2] });
    } else if (cmd === 'H') {
      cur && cur.points.push({ x: seg[1], y });
    } else if (cmd === 'V') {
      cur && cur.points.push({ x, y: seg[1] });
    } else if (cmd === 'C') {
      cur && sampleCubic(p0, { x: seg[1], y: seg[2] }, { x: seg[3], y: seg[4] }, { x: seg[5], y: seg[6] }, cur.points);
    } else if (cmd === 'Q') {
      cur && sampleQuad(p0, { x: seg[1], y: seg[2] }, { x: seg[3], y: seg[4] }, cur.points);
    } else if (cmd === 'Z' || cmd === 'z') {
      if (cur) {
        cur.closed = true;
        if (startPt) cur.points.push({ ...startPt });
        if (cur.points.length > 1) polylines.push(cur);
        cur = null;
      }
    }
  });
  if (cur && cur.points.length > 1) polylines.push(cur);
  return polylines;
}

// ── stroke → filled outline ────────────────────────────────────

function dedupe(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 1e-6 || Math.abs(last.y - p.y) > 1e-6) out.push(p);
  }
  return out;
}

function circlePoly(c, r) {
  const pts = [];
  for (let i = 0; i < CIRCLE_SIDES; i++) {
    const a = (i / CIRCLE_SIDES) * Math.PI * 2;
    pts.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
  }
  return pts;
}

function segQuad(a, b, half) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (dy / len) * half, ny = (-dx / len) * half;
  return [
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny },
  ];
}

function squareCap(end, prev, half) {
  const dx = end.x - prev.x, dy = end.y - prev.y;
  const len = Math.hypot(dx, dy) || 1;
  const ex = (dx / len) * half, ey = (dy / len) * half;     // extend direction
  const nx = (dy / len) * half, ny = (-dx / len) * half;    // perpendicular
  const e2 = { x: end.x + ex, y: end.y + ey };
  return [
    { x: end.x + nx, y: end.y + ny },
    { x: e2.x + nx, y: e2.y + ny },
    { x: e2.x - nx, y: e2.y - ny },
    { x: end.x - nx, y: end.y - ny },
  ];
}

function shoelace(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Build a single path `d` (union, non-zero) from same-winding polygons. */
function polygonsToPathD(polys) {
  let d = '';
  for (const raw of polys) {
    if (raw.length < 3) continue;
    const poly = shoelace(raw) < 0 ? raw.slice().reverse() : raw; // force consistent winding
    d += `M${round(poly[0].x)} ${round(poly[0].y)}`;
    for (let i = 1; i < poly.length; i++) d += `L${round(poly[i].x)} ${round(poly[i].y)}`;
    d += 'Z';
  }
  return d;
}

function strokeOutline(polylines, width, { cap = 'butt', join = 'miter' } = {}) {
  const half = width / 2;
  if (half <= 0) return '';
  const polys = [];
  for (const pl of polylines) {
    const pts = dedupe(pl.points);
    if (pts.length < 2) {
      if (pts.length === 1 && cap === 'round') polys.push(circlePoly(pts[0], half));
      continue;
    }
    for (let i = 0; i < pts.length - 1; i++) polys.push(segQuad(pts[i], pts[i + 1], half));
    // interior joins (round — covers the outer wedge for any join type)
    for (let i = 1; i < pts.length - 1; i++) polys.push(circlePoly(pts[i], half));
    if (pl.closed) {
      polys.push(circlePoly(pts[0], half));
    } else if (cap === 'round') {
      polys.push(circlePoly(pts[0], half));
      polys.push(circlePoly(pts[pts.length - 1], half));
    } else if (cap === 'square') {
      polys.push(squareCap(pts[0], pts[1], half));
      polys.push(squareCap(pts[pts.length - 1], pts[pts.length - 2], half));
    }
  }
  return polygonsToPathD(polys);
}

// ── style + transform resolution ───────────────────────────────

function parseAttrs(raw) {
  const attrs = {};
  const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(raw))) attrs[m[1].toLowerCase()] = m[2] != null ? m[2] : m[3];
  return attrs;
}

const STYLE_KEYS = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'];

function mergeStyle(parent, attrs) {
  const style = { ...parent };
  for (const k of STYLE_KEYS) if (attrs[k] != null) style[k] = attrs[k];
  if (attrs.style) {
    for (const decl of attrs.style.split(';')) {
      const idx = decl.indexOf(':');
      if (idx < 0) continue;
      const k = decl.slice(0, idx).trim().toLowerCase();
      if (STYLE_KEYS.includes(k)) style[k] = decl.slice(idx + 1).trim();
    }
  }
  return style;
}

const hasFill = (style, tag) =>
  tag !== 'line' && tag !== 'polyline' && (style.fill == null || style.fill.toLowerCase() !== 'none');

const hasStroke = (style) =>
  style.stroke != null && style.stroke.toLowerCase() !== 'none' && num(style['stroke-width'], 1) > 0;

// ── SVG tag walker (transform + style stacks) ──────────────────

function extractViewBox(svg) {
  const vb = svg.match(/viewBox\s*=\s*["']([^"']+)["']/i);
  if (vb) return vb[1].trim();
  const w = svg.match(/\bwidth\s*=\s*["']([\d.]+)/i);
  const h = svg.match(/\bheight\s*=\s*["']([\d.]+)/i);
  if (w && h) return `0 0 ${w[1]} ${h[1]}`;
  return '0 0 1000 1000';
}

function walkGeometry(svg, onGeom) {
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
  const tStack = [];                 // transform strings (outermost → innermost)
  const sStack = [{}];               // inherited styles
  const frames = [];                 // {pushedT} for every open container, to balance closes
  let m;
  while ((m = tagRe.exec(svg))) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const selfClose = m[4] === '/';
    if (closing) {
      const f = frames.pop();
      if (f) { if (f.pushedT) tStack.pop(); sStack.pop(); }
      continue;
    }
    const attrs = parseAttrs(m[3]);
    const style = mergeStyle(sStack[sStack.length - 1], attrs);
    if (SHAPES.has(tag)) {
      const chain = [...tStack, attrs.transform || ''].join(' ').trim();
      onGeom({ tag, attrs, style, chain });
      if (!selfClose) { frames.push({ pushedT: false }); sStack.push(style); } // shape with children (rare)
    } else if (!selfClose && tag !== 'svg') {
      const pushedT = !!attrs.transform;
      frames.push({ pushedT });
      if (pushedT) tStack.push(attrs.transform);
      sStack.push(style);
    } else if (!selfClose && tag === 'svg') {
      frames.push({ pushedT: false });
      sStack.push(style);
    }
  }
}

// ── public API ─────────────────────────────────────────────────

/**
 * Convert an SVG into black-filled vector paths.
 * @param {string} svgContent
 * @returns {{ vectorized: string, paths: number } | { error: string }}
 */
function vectorizeSvg(svgContent) {
  if (!svgContent || typeof svgContent !== 'string' || !/<svg[\s>]/i.test(svgContent)) {
    return { error: 'No SVG content provided.' };
  }
  const viewBox = extractViewBox(svgContent);
  const out = [];

  walkGeometry(svgContent, ({ tag, attrs, style, chain }) => {
    const localD = shapeToPath(tag, attrs);
    if (!localD) return;

    if (hasFill(style, tag)) {
      let p = svgpath(localD).abs();
      if (chain) p = p.unarc().transform(chain);
      const d = p.round(3).toString();
      if (d) out.push(d);
    }
    if (hasStroke(style)) {
      const width = num(style['stroke-width'], 1);
      const outlineD = strokeOutline(flattenToPolylines(localD), width, {
        cap: (style['stroke-linecap'] || 'butt').toLowerCase(),
        join: (style['stroke-linejoin'] || 'miter').toLowerCase(),
      });
      if (outlineD) {
        let p = svgpath(outlineD).abs();
        if (chain) p = p.transform(chain);
        const d = p.round(3).toString();
        if (d) out.push(d);
      }
    }
  });

  if (out.length === 0) return { error: 'No drawable geometry found in SVG.' };

  const paths = out.map((d) => `<path d="${d}" fill="#000"/>`).join('');
  const vectorized = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="#000">${paths}</svg>`;
  return { vectorized, paths: out.length };
}

module.exports = {
  vectorizeSvg,
  // exported for unit tests
  shapeToPath,
  flattenToPolylines,
  strokeOutline,
};
