#!/usr/bin/env node
'use strict';

/**
 * svg-to-font — create a BRAND-NEW icon font from one SVG or a folder of SVGs.
 *
 * HTTP-free: drives lib/icon-pipeline.js directly (no web server, no MCP).
 * Writes three portable files into <out-dir>: <Name>.woff, <Name>.css, metadata.json.
 * The .woff + .css pair can be copied into any project — see the skill's
 * "Use the font in any project" section.
 *
 * Usage:
 *   node svg-to-font.js <svg-file-or-folder> [out-dir] [options]
 *
 * Options:
 *   --name   <FontName>   Font family + output filename stem   (default: CustomFont)
 *   --prefix <px>         CSS class prefix, e.g. "icon" → .icon-star (default: icon)
 *   --size   <px>         Box size; icon contained, larger side fills it (default: 28)
 *
 * Example:
 *   node svg-to-font.js ./assets/icons dist/fonts --name MyIcons --prefix mi
 *   → dist/fonts/MyIcons.woff, dist/fonts/MyIcons.css, dist/fonts/metadata.json
 */

const fs = require('fs');
const path = require('path');

/**
 * Load the woff-tool pipeline. Works both inside the repo and when this script
 * is copied into another project that has installed `@tnthangvn/woff-tool`.
 */
function loadPipeline() {
  // 1) In-repo: walk up from this script to find lib/icon-pipeline.js.
  let dir = __dirname;
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, 'lib', 'icon-pipeline.js');
    if (fs.existsSync(candidate)) return require(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 2) Installed as a dependency in another project.
  try {
    return require('@tnthangvn/woff-tool/lib/icon-pipeline');
  } catch (_) {
    /* fall through to the error below */
  }
  throw new Error(
    'Could not load the woff-tool pipeline. Either run this script inside the ' +
      'convert-font repo, or `npm i -D @tnthangvn/woff-tool` in this project.'
  );
}

function parseArgs(argv) {
  const positional = [];
  const opts = { name: 'CustomFont', prefix: 'icon', size: 28 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--name') opts.name = argv[++i];
    else if (arg === '--prefix') opts.prefix = argv[++i];
    else if (arg === '--size') opts.size = Number(argv[++i]);
    else positional.push(arg);
  }
  opts.input = positional[0];
  opts.outDir = positional[1] || 'dist/fonts';
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.input) {
    console.error('Usage: node svg-to-font.js <svg-file-or-folder> [out-dir] [--name N] [--prefix p] [--size px]');
    process.exit(1);
  }
  if (!fs.existsSync(opts.input)) {
    console.log(JSON.stringify({ success: false, error: `Input not found: ${opts.input}` }));
    process.exit(1);
  }

  const { createFontFromSvgs } = loadPipeline();

  let result;
  try {
    result = await createFontFromSvgs({
      svgPaths: opts.input,
      fontFamily: opts.name,
      prefix: opts.prefix,
      width: opts.size,
      height: opts.size,
      cssFontPath: `${opts.name}.woff`, // .css and .woff sit side by side in out-dir
    });
  } catch (err) {
    console.log(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  }

  const outDir = path.resolve(opts.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const woffPath = path.join(outDir, `${opts.name}.woff`);
  const cssPath = path.join(outDir, `${opts.name}.css`);
  const metaPath = path.join(outDir, 'metadata.json');
  fs.writeFileSync(woffPath, result.woffBuffer);
  fs.writeFileSync(cssPath, result.cssText);
  fs.writeFileSync(metaPath, JSON.stringify(result.metadata, null, 2));

  console.log(
    JSON.stringify(
      {
        success: true,
        font: opts.name,
        prefix: result.prefix,
        glyphCount: result.glyphs.length,
        added: result.added.map((g) => g.name),
        skipped: result.skipped,
        files: { woff: woffPath, css: cssPath, metadata: metaPath },
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.log(JSON.stringify({ success: false, error: err.message }));
  process.exit(1);
});
