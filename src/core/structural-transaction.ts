let structuralTransactionDepth = 0;

/** Mark a synchronous editor transaction as an intentional structure change. */
export function runStructuralTransaction<T>(change: () => T): T {
	structuralTransactionDepth += 1;
	try {
		return change();
	} finally {
		structuralTransactionDepth -= 1;
	}
}

export function isStructuralTransaction(): boolean {
	return structuralTransactionDepth > 0;
}
