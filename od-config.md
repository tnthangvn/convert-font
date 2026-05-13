# Open Design Theme Config

## Product

WOFF Tool is a single-page web app styled with a Gradient-inspired design system.

## Theme behavior

- Default theme mode: `system`
- Theme choice persists in `localStorage` key: `woff-tool-theme`
- Supported saved values:
  - `system`
  - `dark`
  - `light`
- Toggle cycle:
  1. System
  2. Dark
  3. Light

## Runtime theme attributes

The app sets `data-theme` on `<html>`:

- `data-theme="system"` for system-following mode
- `data-theme="dark"` for forced dark mode
- `data-theme="light"` for forced light mode

CSS uses:

```css
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    /* dark tokens */
  }
}

:root[data-theme="dark"] {
  /* dark tokens */
}
```

## Core palette

Light/default tokens:

```css
--primary: #990FFA;
--secondary: #E60076;
--success: #16A34A;
--warning: #D97706;
--danger: #DC2626;
--surface: #FFFFFF;
--text: #111827;
```

Dark mode keeps same brand colors, but swaps background/surface/text/border tokens for dark readable surfaces.

## Typography

```css
--font-display: "Space Grotesk", system-ui, sans-serif;
--font-body: "Montserrat", system-ui, sans-serif;
--font-mono: "JetBrains Mono", ui-monospace, monospace;
```

## Files to copy/check on another PC

- `public/index.html` — theme toggle markup.
- `public/index.css` — light/dark token definitions and themed component styles.
- `public/app.js` — theme persistence, system default, toggle behavior.
- `od-config.md` — this config note.
