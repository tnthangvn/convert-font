# WOFF Tool

Internal single-page web tool for creating and editing `.woff` font files from SVG glyphs.

## Prerequisites

- Node.js 18+

## Setup

```bash
npm install
npm run dev
```

Open [http://localhost:3456](http://localhost:3456) in your browser.

## Usage

1. **Open .woff** — load an existing `.woff` file to view/extend its glyphs
2. **Create New** — start a blank font set
3. **Add SVGs** — drag & drop or browse for `.svg` files (multiple supported)
4. **Rename glyphs** — click any glyph title to rename it inline
5. **Sort by name** — sort glyphs alphabetically and re-index codepoints
6. **Re-index** — manually reassign codepoints from a custom start value
7. **Preview CSS** — view the generated CSS on-page before downloading
8. **Generate** — click "Generate .woff" to produce the output
9. **Download** — save the generated `.woff` and `.css` files

## Testing

```bash
npm test
```

## Dependencies (all MIT)

| Package | Purpose |
|---------|---------|
| express | HTTP server |
| multer | File upload handling |
| cors | Cross-origin support |
| svgicons2svgfont | SVG icons → SVG font |
| svg2ttf | SVG font → TTF |
| ttf2woff | TTF → WOFF |
| opentype.js | Parse existing .woff files |
