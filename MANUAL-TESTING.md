# Manual testing checklist

## Block layout and controls

- Verify Toggle blocks have one continuous subtle outline with no empty header row in Live Preview.
- Repeatedly type, paste, press Enter, and undo in headings and at the first and last content positions; confirm the complete frame and toolbar never disappear. Repeat with blank variants and LF/CRLF notes in light and dark themes.
- Confirm only the marker shows at rest on pointer devices; hover and keyboard focus reveal labels, the Add variant button, and Toggle/Columns without clipping in narrow panes or at zoomed text sizes.
- Confirm touch controls remain visible and at least 44px, long labels scroll safely, and reduced motion disables reveal animation.
- Confirm the menu order is **Add variant**, **Rename variant**, **Delete variant**, separator, **Box name**, **Authored default**, **Authored view**, **Edit column relative widths**, **Narrow-screen layout**, separator, **Follow global state**, and **Reset to authored defaults**.
- Hover or focus **Narrow-screen layout** and confirm its attached submenu checks exactly one of **Wrap into rows**, **Stack vertically**, and **Scroll horizontally**. Change each option and verify the open note updates immediately and Undo restores the previous source.
- Select several choices in **Authored default**, **Authored view**, and **Narrow-screen layout** without dismissing the menu. Confirm each submenu remains attached, moves its check immediately, and the rendered block changes without reloading. Move between submenus and verify their latest checks are retained.
- Set a distinct local label/view, enable **Follow global state**, then change the global label/view. Confirm the block follows globally while retaining its local layer. Disable following and verify the exact earlier local label/view returns. Repeat after reopening the note.
- Confirm the block marker’s blue dot appears exactly when **Follow global state** is checked. Change away from authored defaults and confirm the blue dot does not represent that difference; instead, **Reset to authored defaults** shows a distinct **Modified** badge in the menu.
- Hover and keyboard-focus Rename/Delete; verify their variant submenus open without a click, touch the parent menu, flip inside narrow/pop-out viewports, support arrow keys/Escape, and remain 44px on mobile.
- Give a box a name during insertion and through the inline **Box name** submenu field; verify Enter writes it immediately, clearing the field removes the attribute, and other authored settings remain unchanged. Change **Authored default** and **Authored view** from their checked submenus. Confirm the name aligns with the controls without creating unused grid tracks.
- Open **Edit column relative widths**, change ratios, and verify it is the only box-configuration dialog. Equal ratios restore equal-width columns.
- Add variants with shorthand-safe and punctuation-bearing labels. Rename by choosing the target from the attached submenu and confirming the new label. Delete from two variants down to one and confirm the box remains rendered and editable; verify deletion is disabled only for the final variant.
- In Insert/Add dialogs, focus every label field and verify current-note suggestions appear frequency-first, filter case-insensitively, preserve authored casing, and exclude labels already present in that box.
- Use the `+` beside a block's labels to open Add variant, then add another label and reopen it; confirm every current box label is absent from autocomplete without refreshing the note.
- Add, rename, delete, and configure a box from Live Preview and Reading View; verify every change appears immediately without reloading and one Undo reverses it.
- Verify the note-wide control sits above Obsidian's actual status bar, stays inside bottom/right safe areas, and expands left. Resize and show/hide the status bar in main and pop-out windows.
- Put every box in Columns view and use the note-wide label buttons. Confirm a fully visible label hides in every matching box, a mixed/hidden label becomes visible everywhere, and boxes without that label are unchanged.
- In note-wide Columns view, use the eye toggle to hide every column in every valid box. Confirm it changes to **Show all columns**, restores all columns on the next click, clears active inline editors when hiding, and remains a 44px touch target on mobile.
- Opt several blocks out of global following, then select **Force global state everywhere** in the note-wide control. Confirm every block follows immediately and that opting one out again restores its previously saved local state.

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
- Verify responsive Columns fill the complete frame on wide panes. Configure unequal per-variant ratios and confirm each current label keeps its share when other columns are hidden, added, or deleted. Choose Wrap, Stack vertically, and Scroll horizontally directly from the block context menu on narrow panes. Confirm there is no general configuration dialog or plugin setting for this choice, while legacy `view="auto"`, CSS `widths`, and `min-width` source remain readable.
- Check hidden-column restoration from the hover control, the all-hidden empty state, and **Restore focused columns**.
- Check Shift-select across the note, authored reset/global following, Source mode fence editing, print defaults, and HTML export.
- Repeat key checks on desktop, iOS/Android-sized panes, nested blocks, mixed global state, and virtualized/pop-out Reading Views.
