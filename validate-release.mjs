import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));

const errors = [];
if (manifest.id !== 'section-variants') errors.push('manifest id must be section-variants');
if (!/^[a-z][a-z-]*$/u.test(manifest.id)) errors.push('manifest id must contain lowercase letters and hyphens only');
if (manifest.version !== packageJson.version) errors.push('package and manifest versions must match');
if (versions[manifest.version] !== manifest.minAppVersion) errors.push('versions.json must map the release to minAppVersion');
if (manifest.isDesktopOnly !== false) errors.push('the plugin must remain mobile compatible');

if (errors.length > 0) {
	throw new Error(errors.join('\n'));
}
