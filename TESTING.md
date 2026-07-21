# Section Variants acceptance checklist

Run the automated release gate first:

```bash
npm run check
```

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
- Toggle, columns, auto, responsive wrapping, stacking, scrolling, column hiding, saved visibility, and default indicators work.
- Every valid block has a subtle theme-aware border. Only the layers marker remains at rest; hover or focus reveals the quiet label selector, while view modes and advanced actions remain in the marker menu.
- The top-right sticky control follows the same marker/reveal pattern, reports mixed and default-difference state through its marker and tooltip, and synchronizes multiple panes of the same note.
- Live Preview hides inactive content; columns show rendered previews; selecting **Edit** reveals source; the marker menu or `Escape` exits editing.
- At the first content position, repeated Backspace never removes a newline or fence. At the final content position, Delete never removes the closing fence, while Enter and typing remain inside the variant before that fence.
- Repeat fence hiding and boundary edits in an LF note and a CRLF note. Insert text above a block and confirm **Edit** still selects the current variant offset.
- Selections, paste, cut, drop, undo/redo, and multi-cursor edits cannot cross a valid block's hidden fences or a nested block boundary.
- Source mode exposes every fence and variant without decorations.
- Commands, `/variants`, `::: variants`, and label autocomplete work without assigned default hotkeys.
- Rename, authored configuration, reset, stable-ID creation, and the unambiguous missing-closer fix change only the intended source ranges.
- Verify automatic and explicit ID creation retain local selections, saved/session-hidden columns, and active editing. Verify local, note-wide, and case-only renames migrate the same state and update a matching global label only for note-wide rename.
- Duplicate labels, bad attributes, fewer than two variants, and malformed nesting leave all source content visible with a diagnostic.
- Reopening the note restores plugin state, while reset returns to authored defaults.
- With global label/view state active, **Reset this block** keeps following later authored-default edits and ignores global state. A later local or note-wide choice clears only its corresponding authored marker; **Follow global state** clears both dimensions.
- Invalid blocks do not appear in global selectors, rename-across-note results, command counts, or note-wide application counts.
- On mobile, label, marker, column edit, and column hide controls have 44px targets; on pointer-capable devices the compact hover/focus behavior remains unchanged.
- Native PDF uses authored defaults. HTML export produces authored-default and current-state files without overwriting an existing file.
- Disabling and re-enabling the plugin does not leave toolbars, sticky controls, listeners, or editor decorations behind.
