# Section Variants acceptance checklist

Run the automated release gate first:

```bash
npm run check
```

Also run `npm run test:obsidian` with `OBSIDIAN_EXECUTABLE`, optionally `OBSIDIAN_ASAR` and `OBSIDIAN_THEME_DIR`, after building. Browser tests use a host-contract double; they cannot establish actual Obsidian theme parity. The isolated desktop test compares native DOM and computed styles, tight-list item distances, and callout title-to-content gaps, including theme changes without reopening. It preserves Obsidian's own Live Preview callout outer-margin rule rather than adding a plugin override. Mobile, pop-out windows, and IME still require device/manual checks.

For manual testing, reload Obsidian after building and create a note containing:

```markdown
:::: {.variants #demo-one view="toggle" default="A"}

::: A
## Shared heading

Variant A with an [[Internal link]].
:::

::: {.variant label="Long label"}
## Shared heading

Variant B with **formatting**.

:::: variants
::: NestedA
Nested one.
:::
::: NestedB
Nested two.
:::
::::
:::

::::

:::: {.variants view="columns" widths="1fr 2fr"}
::: A
Matching A.
:::
::: C
Only C.
:::
::::
```

Verify on desktop and mobile:

- Reading view switches one block, shift-select applies matching labels, and unmatched blocks stay unchanged.
- Split a block across Reading View render chunks, scroll until a later virtualized chunk appears, and verify it mounts only after both fences are available. Repeated identical `:::` text and incomplete mappings must remain fail-visible. Repeat in a pop-out window.
- Toggle, responsive columns, stacking, scrolling, column hiding, saved visibility, and default indicators work. Legacy `view="auto"` resolves to Columns but is absent from new UI choices.
- Every valid block has a subtle theme-aware border. Only the layers marker remains at rest; hover or focus reveals the quiet label selector, while view modes and advanced actions remain in the marker menu.
- The top-right sticky control follows the same marker/reveal pattern, reports mixed and default-difference state through its marker and tooltip, and synchronizes multiple panes of the same note.
- Toggle leaves selected content in the owning Obsidian editor. Clicking a Columns preview mounts a native Live Preview editor inside that exact column. Other visible variants, headers, column widths, and the comparison grid remain in place. There is no full-width transition or **Editing below** placeholder.
- Clicking another column switches editing immediately. Clicking outside or pressing `Escape` restores that column's preview; links, checkboxes, buttons, and menus keep their own actions.
- At the first and final positions inside the active native variant, ordinary typing remains inside that variant and preserves its closing fence.
- Repeat fence hiding and boundary edits in an LF note and a CRLF note. Insert text above a block and confirm clicking its content and labels still selects the current variant offset.
- Verify native multiline content, tables, callouts, embeds, and nested blocks remain contained in their column, including during scrolling. Native syntax reveal, wrapping and growth are allowed; activation must not replace or expand the grid to a full-width editor.
- Compare identical Markdown at equal widths inside a variant preview and in normal Reading View with Lucy and the default theme. Check heading colors, sizes, spacing and decorations, paragraphs, lists, links, code, tables, callouts, and embeds. Theme/light-dark changes must apply without reopening the note. Do not expect Reading View and Live Preview spacing to match when a theme deliberately styles them differently.
- Verify IME, autocomplete, embeds, native commands, paste and undo/redo inside the Obsidian-owned column editor. Its source changes must reach the original note immediately. Select-all inside it selects only the variant; whole-note and cross-block selections in the outer editor can still replace complete blocks.
- Remote, programmatic, and externally reconciled Markdown updates remain allowed, including changes to variant structure.
- Source mode exposes every fence and variant without decorations.
- Commands, `/variants`, `::: variants`, and label autocomplete work without assigned default hotkeys.
- Rename, authored configuration, reset, stable-ID creation, and the unambiguous missing-closer fix change only the intended source ranges.
- Verify automatic and explicit ID creation retain local selections, saved/session-hidden columns, and active editing. Verify local, note-wide, and case-only renames migrate the same state and update a matching global label only for note-wide rename.
- Duplicate labels, bad attributes, zero variants, and malformed nesting leave all source content visible with a diagnostic; a temporary one-variant box remains valid.
- Reopening the note restores plugin state, while reset returns to authored defaults.
- With global label/view state active, **Reset this block** keeps following later authored-default edits and ignores global state. A later local or note-wide choice clears only its corresponding authored marker; **Follow global state** clears both dimensions.
- Invalid blocks do not appear in global selectors, rename-across-note results, command counts, or note-wide application counts.
- On mobile, label, marker, column edit, and column hide controls have 44px targets; on pointer-capable devices the compact hover/focus behavior remains unchanged.
- Native PDF uses authored defaults. HTML export produces authored-default and current-state files without overwriting an existing file.
- Disabling and re-enabling the plugin does not leave toolbars, sticky controls, listeners, or editor decorations behind.
