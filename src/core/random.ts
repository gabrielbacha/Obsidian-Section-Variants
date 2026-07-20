/**
 * Fill a buffer with cryptographically random bytes.
 *
 * Uses the unqualified `crypto` global rather than `window.crypto`: every
 * window exposes the same implementation, so the popout-window concern behind
 * the `window`/`activeWindow` convention does not apply here, and the
 * unqualified form also resolves under Node so this module stays testable.
 */
export function randomBytes(length: number): Uint8Array {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	return bytes;
}
