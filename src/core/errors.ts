/** User-facing message for a caught error, with a neutral fallback. */
export function errorMessage(error: unknown): string {
	return error instanceof Error
		? error.message
		: 'The operation could not be completed.';
}
