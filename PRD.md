# PRD: Section Variants for Obsidian

## 1. Product

**Name:** Section Variants

**Positioning:** Switch, compare, and manage parallel versions of Markdown sections within a single Obsidian note.

## 2. Problem

Obsidian users cannot natively maintain multiple versions of the same section while:

- displaying only one version
- comparing versions side by side
- switching one section independently
- switching all matching sections across a note
- preserving clean, readable Markdown

Markdown tables, duplicated notes, callouts, canvases, and existing tabs or columns plugins do not provide synchronized, section-level variant management.

## 3. Core concept

A note may contain multiple **variant blocks**. Each block contains two or more labeled versions of the same section.

Example:

```markdown
## Introduction

:::: {.variants default="A" view="toggle"}

::: A
## Topic 1

Version A content.
:::

::: B

## Topic 1

Version B content.
:::

::::

## Conclusion

```
The user can:

- show one variant
- compare all variants in columns
- change one block
- apply a label or view mode across the current note

## 4. Goals

1. Preserve readable, Pandoc-style Markdown.
2. Support independent and note-wide switching.
3. Support toggle, columns, and responsive layouts.
4. Work in Reading View, Live Preview, Source Mode, desktop, and mobile.
5. Separate authored defaults from temporary UI state.
6. Fail safely without hiding or rewriting uncertain content.

## 5. Non-goals for v1

- Vault-wide synchronization
- Cross-note analytics
- Collaboration-aware state
- Drag-and-drop variant reordering
- Public plugin API
- Advanced theme builder
- Full accessibility hardening beyond standard Obsidian behavior

## 6. Syntax

### 6.1 Canonical container

```markdown
:::: variants
...
::::
```

`variants` is the canonical generated keyword.

Users may opt into semantic aliases such as:

- `versions`
- `alternatives`
- `perspectives`

`column` and `columns` are not aliases. Columns are a display mode.

### 6.2 Variant shorthand

```markdown
:::: variants

::: Buddhist
Content.
:::

::: Stoic
Content.
:::

::::
```

The full safe token after `:::` is the shorthand label. Multiword and punctuation-rich labels are supported through the explicit form.

### 6.3 Explicit Pandoc-style form

```markdown
:::: {.variants #topic-1 view="columns" default="Stoic"}

::: {.variant label="Buddhist"}
Content.
:::

::: {.variant label="Stoic"}
Content.
:::

::::
```

Both shorthand and explicit syntax are supported. The plugin generates shorthand for safe single-token labels and explicit syntax for labels containing spaces or punctuation.

### 6.4 Optional attributes

```markdown
:::: {.variants #topic-1 view="columns" default="A" widths="40% 60%" min-width="320px" responsive="responsive"}

...

::::
```

Supported attributes:

| Attribute   | Purpose                              |
| ----------- | ------------------------------------ |
| `#id`       | Stable semantic identifier           |
| `view`      | `toggle`, `columns`, or `auto`       |
| `default`   | Authored default label               |
| `widths`    | CSS grid track values                |
| `min-width` | Minimum column width before stacking |
| `responsive` | `responsive`, `stack`, or `scroll` |

Opening fences and their attributes must fit on one line. Labels are nonempty, single-line Unicode strings. Labels containing spaces or punctuation use the explicit `.variant` form.

The first declared variant is the implicit default.

The implicit view is `toggle`.

## 7. Display modes

### 7.1 Toggle

Displays one selected variant.

Inactive variants are hidden in Reading View.

### 7.2 Columns

Displays all currently visible variants side by side.

Default behavior:

- equal-width columns
- minimum width of `320px`
- stack vertically when space is insufficient
- two variants remain side by side when possible
- three or more variants use equal-width tracks until stacking is required

Supported width examples:

```markdown
widths="40% 60%"
widths="320px 1fr"
widths="1fr 1fr 2fr"
```

Invalid values fall back to equal widths.

### 7.3 Auto

Uses columns when sufficient width exists and toggle or stacked presentation on narrow surfaces.

### 7.4 Responsive overrides

Each block may use:

- `responsive`
- `stack`
- `scroll`

The default is `responsive`.

## 8. Per-block controls

Each rendered block has a compact toolbar:

```text
A | B | C    Toggle / Columns / Auto    ⋯
```

Behavior:

- clicking a label changes that block
- `Shift + click` applies the label to every matching block in the note
- the overflow menu exposes:
  - apply to this block
  - apply to all matching blocks
  - follow global state
  - reset this block
  - set default view
  - configure widths
  - configure responsive behavior
  - pin toolbar

The toolbar:

- appears on hover in Reading View
- remains visible while editing in Live Preview
- may be pinned per block

## 9. Note-wide control

An optional sticky control provides note-level switching.

It shows the union of labels across the note, ordered by first appearance.

Selecting a label:

- switches every block containing an exact, case-insensitive label match
- preserves each block’s authored casing
- leaves unmatched blocks unchanged
- reports the result, for example: `Applied to 8 blocks, skipped 2`

The control also supports applying a view mode to all blocks.

When compatible blocks have different active selections, it displays `Mixed`.

Global actions override current local selections but do not permanently lock blocks.

## 10. State model

### 10.1 Markdown stores authored intent

Markdown may store:

- default variant
- default view
- widths
- minimum width
- semantic ID
- responsive behavior

### 10.2 Plugin data stores UI state

Plugin data stores:

- last selected variant per block
- last selected view per block
- local overrides
- temporary hidden columns
- sticky-control state
- device-specific preferences
- Live Preview inactive-content behavior

Clicking controls must not rewrite Markdown, except when the user has opted into automatic stable-ID creation for an ambiguous block.

### 10.3 State precedence

Current UI state resolves in this order:

1. Session-only state
2. Persisted per-block UI state
3. Compatible note-wide state
4. Authored Markdown defaults
5. Vault-wide plugin settings
6. Built-in defaults

Markdown attributes define authored defaults; they do not prevent temporary or persisted UI selections from overriding those defaults.

### 10.4 Reopening notes

The plugin restores the last-used state.

When no saved state exists, it uses authored defaults.

A command resets all blocks to authored defaults.

## 11. Default-difference indicator

When current state differs from the authored default, the block shows a subtle indicator.

The sticky note control also shows an indicator when any block differs.

Hover reveals details such as:

```text
Current variant: B
Default variant: A
Current view: columns
Default view: toggle
```

No detailed text is shown until hover or focus.

## 12. Live Preview and editor behavior

### Reading View

- Toggle mode renders only the selected variant.
- Columns mode renders all visible variants.
- Auto mode responds to available width.

### Live Preview

Inactive variants may be:

- represented by compact collapsed placeholders, default
- fully hidden

This may be configured globally, per note, or per block.

In columns mode, Live Preview displays rendered columns. Selecting **Edit** on a column reveals that variant's source below the preview while the remaining columns stay rendered. Selecting **Done editing** or pressing `Escape` returns to the compact preview.

### Source Mode

All Markdown remains visible and unchanged.

## 13. Column visibility

In columns view, each column has an eye control.

Hiding a column:

- affects only the current session by default
- does not change the selected toggle variant
- may be explicitly saved as the block state

## 14. Labels

Labels are unrestricted and may contain spaces.

Autocomplete suggests labels already used in the current note, ranked by:

1. frequency
2. recent use

Labels are matched case-insensitively for global actions.

Display casing remains exactly as authored.

Labels must be unique within a block.

Duplicate labels produce an error and offer only:

- Rename duplicate

No merge operation is provided.

Renaming offers:

- Rename in this block
- Rename across the current note

Vault-wide rename is excluded from v1.

## 15. Block identity

Explicit Pandoc IDs take precedence:

```markdown
::: variants {#topic-1}
```

When persistent identity is needed and no explicit ID exists, the plugin adds an Obsidian block ID after the closing fence:

```markdown
:::
^variants-k7m2q
```

The ID is added only when required to preserve persistent state across movement or reordering and only after the user explicitly selects **Add stable ID** or enables automatic block-ID creation. Other toolbar interactions do not rewrite Markdown.

## 16. Creation workflows

The plugin supports:

1. `/variants`
2. Command palette: `Insert variants block`
3. Autocomplete after typing `::: variants`

The insertion interface asks for:

- labels
- default label
- default view
- number of variants

Defaults:

- labels: `A`, `B`
- view: `toggle`
- default: first label

## 17. Commands and hotkeys

The plugin registers commands for:

- Insert variants block
- Select next variant
- Select previous variant
- Apply next variant across note
- Apply previous variant across note
- Open global variant selector
- Cycle block view
- Apply view across note
- Reset focused block
- Reset all blocks to defaults
- Toggle sticky note control
- Toggle inactive Live Preview visibility

No keyboard shortcuts are assigned by default.

Users may assign them through Obsidian Hotkeys settings.

## 18. Nested blocks

Nested variant blocks are supported.

Rules:

- nested blocks maintain independent state
- global matching applies regardless of nesting depth
- parent visibility determines whether nested blocks render
- malformed nesting must fail visibly and safely

## 19. Invalid syntax

The parser must never hide content when syntax is uncertain.

For malformed blocks:

- render all content visibly
- show a subtle warning
- explain the exact issue on hover
- offer `Fix block` only when correction is unambiguous
- never rewrite content without explicit user action

Possible errors include:

- missing closing fence
- duplicate label
- invalid attribute
- invalid nesting
- empty variants block
- fewer than two variants

## 20. Export behavior

### PDF and HTML

- `toggle`: export the authored default variant
- `columns`: export all authored columns
- `auto`: export as columns when supported, otherwise stacked

The plugin's HTML export command explicitly offers authored-default or current-state export. Native PDF export uses authored defaults and never depends on transient hidden-column state.

### Raw Markdown

Preserve the complete fenced-div source and all variants.

Exports must not depend on transient plugin state unless the user explicitly chooses current-state export.

## 21. Mobile

Mobile is supported in v1.

Behavior:

- toggle mode works normally
- columns stack by default
- sticky controls remain available
- Live Preview supports collapsed or hidden inactive variants
- custom width editing is desktop-oriented
- horizontal scrolling is available only when explicitly forced

## 22. Settings

Vault-wide settings include:

- default view
- default minimum column width
- Live Preview inactive behavior
- responsive columns behavior
- sticky control enabled
- toolbar visibility
- automatic block-ID creation
- supported container aliases
- export defaults
- indicator visibility

Per-note and per-block settings may override vault settings.

## 23. Acceptance criteria

The v1 release is complete when a user can:

1. Create a valid variants block through all three insertion workflows.
2. Use unrestricted labels with autocomplete.
3. Switch one section independently.
4. Apply a label to all matching sections in the current note.
5. Use toggle, columns, and auto views.
6. Configure CSS-style column widths.
7. Restore state after reopening a note.
8. Distinguish current state from authored defaults.
9. Reset one block or the full note.
10. Edit content safely in Live Preview.
11. Use nested variant blocks.
12. Export deterministically.
13. Use the plugin on Obsidian mobile.
14. Recover all content visibly when syntax is malformed.
15. Keep Markdown readable without depending on proprietary serialized structures.
