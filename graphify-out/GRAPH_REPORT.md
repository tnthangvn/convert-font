# Graph Report - .  (2026-04-18)

## Corpus Check
- 6 files · ~17,047 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 53 nodes · 106 edges · 10 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `showError()` - 10 edges
2. `renderGlyphList()` - 10 edges
3. `hideError()` - 9 edges
4. `show()` - 7 edges
5. `hide()` - 7 edges
6. `reindexGlyphs()` - 7 edges
7. `normalizeOne()` - 7 edges
8. `normalizeAll()` - 7 edges
9. `handleSvgFiles()` - 7 edges
10. `goToWorkspace()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `showError()` --calls--> `show()`  [EXTRACTED]
  public/app.js → public/app.js  _Bridges community 2 → community 3_
- `renderGlyphList()` --calls--> `show()`  [EXTRACTED]
  public/app.js → public/app.js  _Bridges community 2 → community 1_
- `normalizeOne()` --calls--> `showError()`  [EXTRACTED]
  public/app.js → public/app.js  _Bridges community 3 → community 5_
- `handleSvgFiles()` --calls--> `showError()`  [EXTRACTED]
  public/app.js → public/app.js  _Bridges community 3 → community 1_
- `normalizeOne()` --calls--> `hideError()`  [EXTRACTED]
  public/app.js → public/app.js  _Bridges community 2 → community 5_

## Communities

### Community 0 - "Community 0"
Cohesion: 0.24
Nodes (3): codepointToCssEscape(), codepointToHex(), createGlyphCard()

### Community 1 - "Community 1"
Cohesion: 0.36
Nodes (8): handleDrop(), handleReindex(), handleSvgFiles(), nextId(), reindexGlyphs(), renderGlyphList(), sanitizeName(), sortGlyphsAZ()

### Community 2 - "Community 2"
Cohesion: 0.46
Nodes (8): formatBytes(), goToStart(), goToWorkspace(), handleGenerate(), handleWoffOpen(), hide(), hideError(), show()

### Community 3 - "Community 3"
Cohesion: 0.47
Nodes (6): downloadCss(), fetchGeneratedCss(), handleCopyCss(), handleExportCss(), handlePreviewCss(), showError()

### Community 4 - "Community 4"
Cohesion: 0.5
Nodes (2): generateWoff(), parseWoff()

### Community 5 - "Community 5"
Cohesion: 0.6
Nodes (5): getNormSettings(), invalidateCssPreview(), normalizeAll(), normalizeOne(), normalizeSvgClient()

### Community 6 - "Community 6"
Cohesion: 0.5
Nodes (0): 

### Community 7 - "Community 7"
Cohesion: 1.0
Nodes (2): buildCssText(), formatCssEscape()

### Community 8 - "Community 8"
Cohesion: 1.0
Nodes (0): 

### Community 9 - "Community 9"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **Thin community `Community 8`** (2 nodes): `normalize-svg.js`, `normalizeSvg()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 9`** (1 nodes): `generate-css.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `renderGlyphList()` connect `Community 1` to `Community 0`, `Community 2`, `Community 5`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **Why does `showError()` connect `Community 3` to `Community 0`, `Community 1`, `Community 2`, `Community 5`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Why does `hideError()` connect `Community 2` to `Community 0`, `Community 1`, `Community 3`, `Community 5`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._