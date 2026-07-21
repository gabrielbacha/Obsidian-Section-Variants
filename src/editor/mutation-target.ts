export interface MutationEditorCandidate<T> {
	editor: T;
	containsOrigin: boolean;
	sameDocument: boolean;
	active: boolean;
}

/** Prefer the pane that opened the action, including its pop-out document. */
export function chooseMutationEditor<T>(
	candidates: readonly MutationEditorCandidate<T>[],
): T | undefined {
	return (
		candidates.find((candidate) => candidate.containsOrigin) ??
		candidates.find((candidate) => candidate.sameDocument) ??
		candidates.find((candidate) => candidate.active) ??
		candidates[0]
	)?.editor;
}
