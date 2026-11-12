import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));

const errors = [];
const flag=process.argv.indexOf('--tag');
const tag=flag>=0?process.argv[flag+1]:process.env.GITHUB_REF_TYPE==='tag'?process.env.GITHUB_REF_NAME:undefined;
if(flag>=0&&!tag)errors.push('release tag is required');
if(tag!==undefined&&(!/^\d+\.\d+\.\d+$/u.test(tag)||tag!==manifest.version))errors.push('release tag must exactly match manifest.version without a v prefix');
if (manifest.id !== 'section-variants') errors.push('manifest id must be section-variants');
if (!/^[a-z][a-z-]*$/u.test(manifest.id)) errors.push('manifest id must contain lowercase letters and hyphens only');
if (manifest.version !== packageJson.version) errors.push('package and manifest versions must match');
if (versions[manifest.version] !== manifest.minAppVersion) errors.push('versions.json must map the release to minAppVersion');
if (manifest.isDesktopOnly !== false) errors.push('the plugin must remain mobile compatible');

if (errors.length > 0) {
	throw new Error(errors.join('\n'));
}
