/** Track the newest asynchronous refresh request independently for each path. */
export class LatestPathGeneration {
	private readonly generations = new Map<string, number>();

	next(path: string): number {
		const generation = (this.generations.get(path) ?? 0) + 1;
		this.generations.set(path, generation);
		return generation;
	}

	isCurrent(path: string, generation: number): boolean {
		return this.generations.get(path) === generation;
	}

	invalidate(path: string): void {
		this.next(path);
	}

	clear(): void {
		this.generations.clear();
	}
}
