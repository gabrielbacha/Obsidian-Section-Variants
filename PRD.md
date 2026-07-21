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
:::: {.variants #topic-1 name="Topic alternatives" view="columns" default="A" widths="40% 60%" min-width="320px" responsive="responsive"}

...

::::
```

Supported attributes:

| Attribute   | Purpose                              |
| ----------- | ------------------------------------ |
| `#id`       | Stable semantic identifier           |
| `name`      | Optional title rendered for the whole box |
| `view`      | `toggle` or `columns`                |
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

### 7.3 Legacy Auto compatibility

Existing `view="auto"` source remains valid and resolves to responsive Columns. Auto is not offered for new state or authored configuration because Columns already adapts to the available width.

### 7.4 Responsive overrides

Each block may use:

- `responsive`
- `stack`
- `scroll`

The default is `responsive`.

## 8. Per-block controls

Each valid rendered block has a quiet continuous border and a compact layers marker. Hovering or focusing the block reveals its variant labels and view choices:

```text
      A | B | C | +    Toggle | Columns    ◉
```

Behavior:

- clicking a label changes that block
- `Shift + click` applies the label to every matching block in the note
- the adjacent Add button opens the current block's Add variant dialog
- the hover/focus surface exposes toggle and columns view modes
- the marker menu contains:
  - add variant
  - rename variant, with an attached hover/focus target submenu and confirmation
  - delete variant, with an attached hover/focus target submenu and destructive confirmation
  - box name and authored-default configuration
  - follow global state
  - reset to authored defaults
- a block may temporarily retain one variant; deleting the final variant is disabled
- focused-block commands provide column visibility persistence, restoration, and stable-ID creation

The controls:

- leave only the layers marker visible at rest
- reveal labels and views on hover or keyboard focus on hover-capable devices
- keep labels and 44px targets available on touch devices
- use theme-native neutral states rather than accent-filled selection pills

Structural actions originating in an open Markdown view commit through one editor transaction so Live Preview, Reading View, undo/redo, and the saved note agree immediately. Atomic vault processing is the fallback for a note without an open editor.

## 9. Note-wide control

An optional sticky control provides note-level switching. It follows the same pattern: a small bottom-right layers marker at rest and note-wide labels and views expanding left on hover or focus. Per-view measurement keeps it above Obsidian's actual status bar, while safe-area offsets keep it clear of device chrome. Measurement uses each view's owner document so pop-out windows remain independent.

It shows the union of labels across the note, ordered by first appearance.

Selecting a label:

- switches every block containing an exact, case-insensitive label match
- preserves each block’s authored casing
- leaves unmatched blocks unchanged
- reports the result, for example: `Applied to 8 blocks, skipped 2`

The marker menu supports applying a view mode to all blocks and hiding the note control.

When compatible blocks have different active selections, the marker uses a dashed outline and its tooltip reports `Mixed`.

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
- explicitly saved hidden columns
- sticky-control state
- per-dimension authored-following markers

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

Resetting a block sets independent authored markers for its label and view, so an existing note-wide value is ignored without copying and freezing the literal authored value. A later local choice clears only its corresponding marker. A note-wide label or view action also clears the corresponding marker on valid blocks. **Follow global state** clears both local overrides and both markers; it follows a compatible global label and any present global view, otherwise falling back to authored state for the unavailable dimension.

Source mutations return old/new block identity mappings. Stable-ID creation and label rename atomically migrate persisted block state, session-hidden columns, editing state, selected labels, and affected note-wide labels before data is flushed. Label normalization is deterministic `trim().toLowerCase()`; schema migration attempts recovery of older locale-sensitive fingerprint keys when they can be reproduced.

### 10.4 Reopening notes

The plugin restores the last-used state.

When no saved state exists, it uses authored defaults.

A command resets all blocks to authored defaults.

## 11. Default-difference indicator

When current state differs from the authored default, the marker shows a subtle dot.

The sticky note control also shows an indicator when any block differs.

The concise marker tooltip reports the useful state on one line, for example:

```text
B · Columns · default A / Toggle
```

No detailed text is shown until hover or focus.

## 12. Live Preview and editor behavior

### Reading View

- Toggle mode renders only the selected variant.
- Columns mode renders all visible variants.
- Legacy Auto source renders as responsive Columns.
- Fence mapping is restricted to each postprocessor section's reported source lines and requires exact text and order.
- Pending sections are aggregated so blocks split across render chunks can mount after both boundaries arrive; later virtualized sections are processed independently.
- Incomplete or ambiguous mappings remain fully visible with a warning.
- Mounts, warnings, and DOM ranges are created through the rendered root's owner document for pop-out windows.

### Live Preview

Inactive variants are fully hidden. Every valid block is replaced by one atomic `LiveBlockWidget` whose root owns the toolbar and visible content. Toggle mode mounts the selected variant as an editable fragment; Columns mode mounts every visible column as an equivalent live fragment, and its A/B controls independently show or hide columns. A single inset content outline replaces the redundant outer frame. Because the content frame and editors share one measured DOM tree, repeated LF, CRLF, and empty-content updates cannot detach the border or hover controls.

Each editable fragment derives its state from the owning Obsidian editor so headings, emphasis, links, lists, Live Preview syntax behavior, theme compartments, and accessibility settings remain intact. All visible Columns panels remain directly editable without an activation step. Valid nested variant blocks remain rendered between editable prose islands. Links, checkboxes, embeds, buttons, and nested controls retain their normal behavior.

Toggle and Columns panels share a compact header: the variant label appears at the top-left, while a top-right copy action copies the exact Markdown content inside that variant without its own fences. Columns place the existing hide action beside copy.

Nested-editor transactions map back to absolute ranges in the owning Obsidian editor, so changes use the note's normal undo history and the outer boundary guard. The editors survive ordinary outer-document updates by rebinding their absolute spans and preserving focus and selection. A truly empty variant gains its required trailing newline with the first insertion. `Escape` returns focus to the owning editor; hiding a column or leaving Columns view removes only the fragments that are no longer visible.

Editor transactions inside a valid rendered block must fit wholly inside one currently editable variant-content span. Nested blocks are removed from their parent's editable spans and expose only their own selected content. This makes Backspace at the opening boundary and Delete at the closing boundary no-ops, keeps typing at the bottom before the closing fence, and rejects selections, paste, cut, drop, undo, redo, or multi-cursor changes that cross a hidden fence or adjacent variant.

The whole valid block replacement is line-aligned through CodeMirror document lines, safe for LF and CRLF, and registered as an atomic range in addition to the transaction guard. Widget equality includes absolute block offsets so edits above a block cannot leave stale selection anchors. Escape has elevated keymap precedence, toolbar actions restore editor focus only when it was already focused, and Shift-select applies a label across valid blocks in the note.

### Source Mode

All Markdown remains visible and unchanged.

Fence protection is disabled in Source mode so structural editing remains possible.

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
2. first authored appearance

Labels are matched case-insensitively for global actions.

Global labels, views, rename-across-note actions, command availability, and result counts include valid blocks only.

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
- Add stable block ID
- Save focused column visibility
- Restore focused columns

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
- inactive Live Preview variants remain hidden
- touch controls remain visible and use 44px targets
- custom width editing is desktop-oriented
- horizontal scrolling is available only when explicitly forced

## 22. Settings

Vault-wide settings include:

- default view
- default minimum column width
- responsive columns behavior
- sticky control enabled
- automatic block-ID creation
- supported container aliases
- export defaults
- indicator visibility

Authored attributes and supported per-note or per-block state may override vault defaults.

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
10. Edit content safely in Live Preview without deleting or crossing hidden fences.
11. Use nested variant blocks.
12. Export deterministically.
13. Use the plugin on Obsidian mobile.
14. Recover all content visibly when syntax is malformed.
15. Keep Markdown readable without depending on proprietary serialized structures.
