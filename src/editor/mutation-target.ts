export interface MutationEditorCandidate<T> {
	editor: T;
	containsOrigin: boolean;
	sameDocument: boolean;
	active: boolean;
	/** Reading View's hidden editor never owns a source mutation. */
	mode?: string;
}

/** Prefer the pane that opened the action, including its pop-out document. */
export function chooseMutationEditor<T>(
	candidates: readonly MutationEditorCandidate<T>[],
): T | undefined {
	const live = candidates.filter((candidate) => candidate.mode === undefined || candidate.mode === 'source');
	return (
		live.find((candidate) => candidate.containsOrigin) ??
		live.find((candidate) => candidate.sameDocument) ??
		live.find((candidate) => candidate.active) ??
		live[0]
	)?.editor;
}
