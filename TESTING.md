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
- Toggle, columns, auto, responsive wrapping, stacking, scrolling, column hiding, saved visibility, and default indicators work.
- The sticky control reports mixed state and synchronizes multiple panes of the same note.
- Live preview collapses or hides inactive content; columns show rendered previews; selecting **Edit** reveals source; `Escape` exits editing.
- Source mode exposes every fence and variant without decorations.
- Commands, `/variants`, `::: variants`, and label autocomplete work without assigned default hotkeys.
- Rename, authored configuration, reset, stable-ID creation, and the unambiguous missing-closer fix change only the intended source ranges.
- Duplicate labels, bad attributes, fewer than two variants, and malformed nesting leave all source content visible with a diagnostic.
- Reopening the note restores plugin state, while reset returns to authored defaults.
- Native PDF uses authored defaults. HTML export produces authored-default and current-state files without overwriting an existing file.
- Disabling and re-enabling the plugin does not leave toolbars, sticky controls, listeners, or editor decorations behind.
