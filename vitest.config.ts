import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			// The real `obsidian` package is types-only, so modules importing it
			// cannot be loaded in tests without a runtime stand-in.
			obsidian: fileURLToPath(
				new URL('./src/test/obsidian-mock.ts', import.meta.url),
			),
		},
	},
});
