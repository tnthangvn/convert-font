# Spec: Icon Normalization and MCP Export for WOFF Tool

## Objective

Extend the existing internal WOFF tool with two new capabilities:

1. Normalize one icon or all icons to a fixed target size and alignment.
2. Expose the latest generated font bundle through MCP so another repository can fetch the generated `font.woff` and preview/icon metadata.

## Feature Scope

This spec covers only the new feature set. The existing base WOFF workflow remains defined in `spec.md`.

## New Requirements

### Icon Normalization

- Support resizing one selected icon to a fixed target width and height.
- Support horizontal alignment within the target box:
  - left
  - center
  - right
- Support vertical alignment within the target box:
  - top
  - center
  - bottom
- Support applying one shared normalization preset to all icons in the current font set.
- The bulk action must support a workflow like `28x28`, `center`, `center`.
- Normalization must be deterministic and repeatable.
- Reapplying normalization must not unintentionally compound prior transforms.
- The implementation should preserve or derive from the original glyph source when normalizing again.
- Normalization must work for newly added `.svg` glyphs.
- If a glyph loaded from an opened `.woff` cannot be safely normalized, surface a readable limitation or error instead of failing silently.

### Generation Impact

- Generated `.woff` output must reflect the current normalized icon geometry.
- A successful generation should also produce the metadata needed for downstream preview usage.
- The downloadable `.woff` and the MCP-exported `.woff` must come from the same generated bundle.

### MCP Export

- Expose an MCP capability so another repository can fetch the latest generated bundle.
- The MCP output must include the latest generated `.woff`.
- The MCP output must include preview/icon metadata for the current glyph set.
- Preview/icon metadata should be machine-readable and sufficient for downstream source-code updates.
- The preview/icon metadata should include, at minimum:
  - glyph name
  - codepoint
  - unicode hex value
  - CSS selector or equivalent identifier
  - CSS content escape or equivalent preview value
  - preview SVG markup or equivalent preview payload
- If no successful generation has happened yet, MCP must return a readable error indicating that no latest artifact is available.
- The MCP contract should be stable and must not depend on scraping the web UI or reading browser memory.

### UI Requirements

- Keep the UI on one page.
- Provide clear controls for:
  - normalizing one selected icon
  - normalizing all icons with one preset
  - starting generation
  - downloading the generated `.woff`
- Show generation status and error states clearly.
- Work on desktop and mobile widths.

## Technical Guidance

- Use the simplest architecture that can reliably normalize icons, generate `.woff`, and expose the latest bundle through MCP.
- A minimal server-side persistence layer for the latest generated bundle is allowed and expected for MCP export.
- Keep the MCP export contract independent from browser-only state.
- Prefer MIT-licensed dependencies when practical.
- If a non-MIT dependency is required, document why before adopting it.
- Keep the implementation modular enough that optional future downstream contracts could be added later without rewriting the whole app.

## Out Of Scope

- New font formats such as `woff2`, `ttf`, or `eot`
- Full font history/versioning
- Advanced font editing beyond fixed-size normalization and alignment
- Cloud storage
- Auth, database, analytics, or background jobs
- Expanding the app into a full font-management platform

## Acceptance Criteria

- User can resize one selected icon to a fixed size and align it within the target box.
- User can resize all icons using one shared preset such as `28x28`, `center`, `center`.
- User can generate a `.woff` file that reflects the current normalized icon geometry.
- Another repository can fetch the latest generated `.woff` and preview/icon metadata through MCP.
- The project includes enough setup notes for another agent or developer to run the MCP surface locally.

## Guardrails

- Do not change the base product scope defined in `spec.md` while implementing this feature spec.
- Do not add auth, database, or background jobs.
- Do not introduce non-MIT dependencies unless clearly necessary and documented.
- If a key technical constraint blocks reliable icon normalization or MCP export, report the constraint before expanding scope.
