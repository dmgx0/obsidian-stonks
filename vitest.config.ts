import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const fromHere = (p: string) =>
	fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
	test: {
		// Default to Node; DOM-dependent files opt into jsdom via a top-of-file
		// `// @vitest-environment jsdom` docblock.
		environment: 'node',
		// Stand in for the Obsidian runtime (requestUrl + class stubs).
		alias: {
			obsidian: fromHere('./test/mocks/obsidian.ts'),
		},
		// Shim Obsidian's HTMLElement helpers onto jsdom (no-op under Node).
		setupFiles: [fromHere('./test/setup/dom.ts')],
	},
});
