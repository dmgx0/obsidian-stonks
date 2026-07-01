// Links the built plugin into example-vault/.obsidian/plugins/stonks so you can
// open ./example-vault in Obsidian and see the live plugin. Symlinks the build
// artifacts (so `npm run dev` keeps them fresh) and drops a `.hotreload` file so
// the Hot Reload plugin reloads on change. Falls back to copying if the OS
// refuses symlinks (e.g. Windows without privileges).
import {
	existsSync,
	mkdirSync,
	rmSync,
	symlinkSync,
	copyFileSync,
	writeFileSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = resolve(
	root,
	'example-vault/.obsidian/plugins/stonks',
);

mkdirSync(pluginDir, { recursive: true });

for (const file of ['main.js', 'manifest.json', 'styles.css']) {
	const src = resolve(root, file);
	const dest = resolve(pluginDir, file);
	if (!existsSync(src)) {
		console.warn(`! ${file} is missing — run \`npm run build\` first.`);
		continue;
	}
	rmSync(dest, { force: true });
	try {
		symlinkSync(src, dest);
		console.log(`linked  ${file}`);
	} catch {
		copyFileSync(src, dest);
		console.log(`copied  ${file}`);
	}
}

// Enables Hot Reload without a .git dir inside the plugin folder.
writeFileSync(resolve(pluginDir, '.hotreload'), '');

console.log('\nExample vault ready. Open ./example-vault in Obsidian.');
console.log('For live reload: run `npm run dev` and install the Hot Reload plugin.');
