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
4. **Generate** — click "Generate .woff" to produce the output
5. **Download** — save the generated `.woff` file

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
