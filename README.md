# Section Variants

Section Variants lets you switch, compare, and manage parallel versions of a Markdown section without splitting them across notes.

## Syntax

Use a Pandoc fenced div containing two or more labeled variant divs:

```markdown
:::: {.variants #introduction view="columns" default="Short"}

::: Short
A concise introduction.
:::

::: {.variant label="Long version"}
A longer introduction with more context.
:::

::::
```

Safe single-token labels use shorthand. Labels containing spaces or punctuation use the explicit `.variant` form. Supported block attributes are:

- `#id`
- `view="toggle|columns|auto"`
- `default="Label"`
- `widths="40% 60%"`
- `min-width="320px"`
- `responsive="responsive|stack|scroll"`

The canonical container is `variants`. Additional aliases can be enabled in **Settings → Section Variants**.

## Using variants

- Hover or focus a bordered block, then select a label to switch that block.
- Shift-select a label to apply it to every matching block in the note.
- Open the small layers marker to choose **Toggle**, **Columns**, or **Auto** and access advanced actions.
- Hide individual columns temporarily and explicitly save visibility when wanted.
- Use the sticky note control to apply labels or views across a note.
- In Live Preview columns, select **Edit** on any column to reveal its source. Choose **Done editing** from the marker menu or press `Escape` when finished.
- Source Mode always displays the complete Markdown source.

Open the command palette for insertion, cycling, note-wide actions, resets, sticky-control visibility, and HTML export. No default hotkeys are assigned.

## Creating blocks

Three insertion paths open the same configuration dialog:

- Run **Section Variants: Insert variants block**.
- Type `/variants`.
- Type `::: variants`.

Typing a variant opener inside an existing block also suggests labels already used in the note.

## State and safety

Authored defaults remain in Markdown. Current selections, view choices, sticky-control state, and explicitly saved column visibility live in plugin data. Ordinary switching never rewrites the note.

**Reset this block** follows its authored label and view even when note-wide state exists; later authored edits are still picked up. **Follow global state** removes both local choices and authored-reset markers, using the note-wide label when compatible and the note-wide view when present. Stable-ID creation and label renames migrate existing selections, hidden columns, edit state, and affected note-wide labels to the new identity.

Inactive variants are hidden in Live Preview. While editing a visible variant, the plugin prevents Backspace, Delete, selections, paste, and other editor transactions from crossing its hidden fences. Switch to Source mode whenever you intend to edit the structure itself.

Blocks use an explicit Pandoc ID, a following Obsidian block ID, or a structural fingerprint for persistence. If duplicate fingerprints become ambiguous, use **Add stable block ID** or enable automatic IDs.

Malformed blocks remain fully visible. The warning explains the exact problem, and automatic fixing is offered only for an unambiguous missing final fence.

Reading View maps fences only within Obsidian's reported source section and requires an exact ordered match. Sections rendered later through virtualization and blocks split across render chunks are aggregated safely; incomplete or ambiguous mappings remain visible with a warning. Pop-out windows use their own document for mounts and ranges.

## Export

- Obsidian PDF export uses authored defaults through print styles.
- **Export variants to HTML** offers authored-default or current-state output and writes a new `.html` file inside the vault.
- HTML export keeps internal links and attachments as references; it does not bundle linked files.
- Raw Markdown always retains every variant.

## Development

Requirements: Node.js 18 or newer and npm.

```bash
npm install
npm test
npm run build
npm run lint
```

`npm run check` runs all release gates. The production release consists of `main.js`, `manifest.json`, and `styles.css`.
