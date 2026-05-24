# Spec: Internal WOFF Tool

## Objective

Build a small internal single-page web tool that lets a user:

1. Open an existing `.woff` file or create a new font set.
2. Add one or more `.svg` files into that font set.
3. Generate updated `.woff` output.
4. Download the generated `.woff` file.

## Confirmed Decisions

- This is an internal tool.
- v1 is a single-page web app.
- The primary format is `.woff`.
- Main input flow: existing `.woff` in, updated `.woff` out.
- `.svg` files are source assets added into the current font set.
- Other formats are optional and out of scope for v1 unless explicitly requested later.
- No authentication.
- No database.
- No background job system.
- Correct output matters more than visual polish.
- Prefer minimal dependencies.
- Prefer MIT-licensed dependencies when practical.
- If multiple `.svg` files are added, they belong to the same current font set.

## Main User Flow

1. User opens the page.
2. User chooses `Open .woff` or `Create new`.
3. The tool loads the selected `.woff` file, or initializes a new empty font set.
4. User adds the first `.svg` file.
5. User can add more `.svg` files.
6. The tool shows the current asset list.
7. User starts generation.
8. The tool generates `.woff`.
9. User downloads the generated `.woff`.

## Required Behavior

### Start Modes

- Support `Open .woff`.
- Support `Create new`.
- Both start modes must lead into the same add-assets and generate flow.

### File Support

- Accept `.woff` only for opening an existing font set.
- Accept `.svg` only for adding new source assets.
- Reject unsupported files with a readable error.
- Reject invalid or unreadable `.woff` files with a readable error.
- Reject invalid `.svg` files with a readable error.

### Asset Handling

- Allow adding multiple `.svg` files in one action.
- Treat all added `.svg` files as glyph sources for the same current font set.
- Use predictable glyph names derived from sanitized filename stems by default.
- Use deterministic codepoint assignment by upload order unless the implementation needs conflict handling for an opened `.woff`.
- Preserve stable, predictable output naming.

### Generation

- Generate `.woff` output from the current font set after `.svg` assets are added.
- Opening an existing `.woff` and creating a new font set must both support generation.
- A failure on one invalid asset must not silently break the whole flow.
- If generation fails, show a readable error.

### Download

- Expose a direct download action for the generated `.woff` file.
- If optional extra output files are ever added later, they may use zip download, but zip is not required for v1.

### UI

- Keep the UI on one page.
- Show two clear entry actions: `Open .woff` and `Create new`.
- Provide an obvious way to add `.svg` files.
- Show the current file or asset list.
- Show generation status and error states clearly.
- Work on desktop and mobile widths.

## Technical Guidance For The Implementing Agent

- Use the simplest architecture that can reliably load `.woff`, add `.svg` assets, and generate `.woff`.
- If browser-only implementation is unreliable, a minimal server-side conversion path is allowed.
- Prefer an existing maintained library or CLI wrapper over custom font-generation logic.
- Prefer MIT-licensed dependencies when practical.
- If a non-MIT dependency is required, document why before adopting it.
- If native packages or unusual system dependencies are required, document them clearly.
- Keep the implementation modular enough that optional formats could be added later without rewriting the whole app.

## Out Of Scope For v1

- `woff2`, `ttf`, `eot`, or other extra export formats.
- Opening formats other than `.woff`.
- Reverse conversion.
- Cloud storage.
- Accounts, admin, analytics, or persistence.
- Advanced font editing.
- Background processing infrastructure.

## Acceptance Criteria

- User can open an existing `.woff` file.
- User can create a new font set.
- User can add at least one valid `.svg` file.
- User can add multiple `.svg` files into the same current font set.
- User can generate a downloadable `.woff` file.
- Unsupported or invalid files produce readable errors.
- Generation failures are surfaced clearly.
- The project includes enough setup notes for another agent or developer to run it locally.

## Agent Guardrails

- Do not add extra formats in v1 unless explicitly requested.
- Do not add auth, database, or background jobs.
- Do not introduce non-MIT dependencies unless clearly necessary and documented.
- Do not widen scope into a full font-management platform.
- If a key technical constraint blocks reliable `.woff` editing or generation, report the constraint before expanding scope.
