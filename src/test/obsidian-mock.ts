/**
 * Minimal stand-in for the `obsidian` module.
 *
 * The real package ships types only, so any module that imports it at runtime —
 * notably `core/mutations.ts`, which is the riskiest code in the plugin — could
 * not be unit tested at all. `vitest.config.ts` aliases `obsidian` here.
 */

export class TAbstractFile {
	constructor(public path: string) {}
}

export class TFile extends TAbstractFile {
	get basename(): string {
		return this.path.replace(/^.*\//u, '').replace(/\.md$/u, '');
	}
}

export class TFolder extends TAbstractFile {}

export class Notice {
	constructor(public message: string) {}
}

/** Records processed content so assertions can read the resulting source. */
export class FakeVault {
	private readonly files = new Map<string, { file: TFile; content: string }>();

	add(path: string, content: string): TFile {
		const file = new TFile(path);
		this.files.set(path, { file, content });
		return file;
	}

	read(path: string): string {
		const entry = this.files.get(path);
		if (!entry) throw new Error(`No such file: ${path}`);
		return entry.content;
	}

	getAbstractFileByPath(path: string): TAbstractFile | null {
		return this.files.get(path)?.file ?? null;
	}

	async process(file: TFile, fn: (source: string) => string): Promise<string> {
		const entry = this.files.get(file.path);
		if (!entry) throw new Error(`No such file: ${file.path}`);
		entry.content = fn(entry.content);
		return entry.content;
	}
}

export class FakeApp {
	readonly vault = new FakeVault();
}

export type App = FakeApp;
