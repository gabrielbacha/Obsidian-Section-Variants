import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		{
			name: 'section-variants-test-styles',
			enforce: 'pre',
			resolveId(id) {
				return id === 'virtual:section-variants-styles'
					? '\0section-variants-styles'
					: undefined;
			},
			load(id) {
				return id === '\0section-variants-styles'
					? `export default ${JSON.stringify(readFileSync(new URL('./styles.css', import.meta.url), 'utf8'))}`
					: undefined;
			},
		},
	],
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
