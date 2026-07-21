# Manual testing checklist

## Block layout and controls

- Verify Toggle blocks have one continuous subtle outline with no empty header row in Live Preview.
- Repeatedly type, paste, press Enter, and undo in headings and at the first and last content positions; confirm the complete frame and toolbar never disappear. Repeat with blank variants and LF/CRLF notes in light and dark themes.
- Confirm only the marker shows at rest on pointer devices; hover and keyboard focus reveal labels, the Add variant button, and Toggle/Columns without clipping in narrow panes or at zoomed text sizes.
- Confirm touch controls remain visible and at least 44px, long labels scroll safely, and reduced motion disables reveal animation.
- Confirm the menu order is **Add variant**, **Rename variant**, **Delete variant**, separator, **Configure box**, **Follow global state**, and **Reset to authored defaults**.
- Hover and keyboard-focus Rename/Delete; verify their variant submenus open without a click, touch the parent menu, flip inside narrow/pop-out viewports, support arrow keys/Escape, and remain 44px on mobile.
- Give a box a name during insertion and through **Configure box**; verify **Save box** writes it immediately, clearing it removes the attribute, and other authored settings remain unchanged. Confirm it aligns with the controls without creating unused grid tracks, while unnamed boxes retain no empty header row.
- Add variants with shorthand-safe and punctuation-bearing labels. Rename by choosing the target from the attached submenu and confirming the new label. Delete from two variants down to one and confirm the box remains rendered and editable; verify deletion is disabled only for the final variant.
- In Insert/Add dialogs, focus every label field and verify current-note suggestions appear frequency-first, filter case-insensitively, preserve authored casing, and exclude labels already present in that box.
- Use the `+` beside a block's labels to open Add variant, then add another label and reopen it; confirm every current box label is absent from autocomplete without refreshing the note.
- Add, rename, delete, and configure a box from Live Preview and Reading View; verify every change appears immediately without reloading and one Undo reverses it.
- Verify the note-wide control sits above Obsidian's actual status bar, stays inside bottom/right safe areas, and expands left. Resize and show/hide the status bar in main and pop-out windows.

## Formatted Live Preview editing

- In Toggle view, confirm the selected variant is immediately editable. Type repeatedly in headings, emphasis, links, and lists and confirm native Live Preview formatting survives edits above the block and undo/redo.
- In Columns view, confirm every visible panel is immediately editable without activation and uses the same formatting-preserving editor. Toggle A/B controls off and on and verify the matching columns hide and return.
- In both views, verify every visible variant shows its label at top-left. Copy before and after editing and confirm the clipboard contains current Markdown content, including nested blocks, without the variant's own fences.
- Start a variant with each Markdown heading level and confirm the first heading has no extra top gap; add a later heading and confirm normal prose spacing remains.
- Verify links, checkboxes, embeds, buttons, column hide controls, and nested variant controls keep their normal behavior.
- Test typing, Enter at the end, repeated input, empty variants, paste, cut, drag/drop, and multiple selections.
- Confirm nested blocks remain rendered between independent prose editors and parent editing cannot expose nested fences.
- Edit above and inside the block; confirm selection and focus survive and absolute offsets remain correct.
- Confirm Obsidian undo/redo includes inline edits. Press Escape and verify focus returns to the owning editor without changing content.
- Hide a focused column and verify its editor is removed safely. Break the block deliberately in Source mode and confirm Live Preview destroys the editors and leaves source fail-visible.

## Compatibility and state

- Verify Reading View stays non-editable and matches Live Preview selection/view state.
- Verify responsive Columns fill the complete frame on wide panes, wrap at the configured minimum width, and preserve explicitly authored custom widths. Confirm legacy `view="auto"` source renders as Columns while Auto is absent from controls and settings.
- Check hidden-column restoration from the hover control, the all-hidden empty state, and **Restore focused columns**.
- Check Shift-select across the note, authored reset/global following, Source mode fence editing, print defaults, and HTML export.
- Repeat key checks on desktop, iOS/Android-sized panes, nested blocks, mixed global state, and virtualized/pop-out Reading Views.
