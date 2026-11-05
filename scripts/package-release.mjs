/* =============================================================
   scripts/package-release.mjs
   Builds the download for one version of Breakaway: a zip with only
   what playing needs, a SHA-256 checksum file, and the release notes
   from CHANGELOG.md.

   Usage, after tagging a commit (see docs/releases.md):
     cd Breakaway
     npm run package -- v1.0.0
   Writes dist/breakaway-v1-vector.zip, dist/breakaway-v1-vector.zip.sha256
   and dist/release-notes.md. Every file comes from the tag, not from the
   working folder, so uncommitted changes never end up in a download.
   The release workflow (.github/workflows/release.yml) runs the same
   command on GitHub when a tag is pushed.

   Sections in this file
     1. What goes in a download
     2. Pure helpers (tested in tests/release/)
     3. Git helpers
     4. packageRelease: build the files for one tag
     5. Command line

   Troubleshooting
   - "tag v1.0.0 doesn't exist": create it first
     (git tag -a v1.0.0 -m "...") or fetch it (git fetch --tags).
   - "package.json at v1.0.0 says version 0.1.0": the tag and the
     version in package.json must match. Fix package.json, commit, and
     move the tag (only if it hasn't been pushed yet).
   - "CHANGELOG.md at v1.0.0 has no section for 1.0.0": add a
     "## [1.0.0] - <date>" section with the changes.
   ============================================================= */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* ---------- 1. What goes in a download ---------- */

/** Files and folders a player needs, in the order they're listed in the zip. */
export const PLAY_PATHS = Object.freeze(['index.html', 'style.css', 'src', 'assets', 'LICENSE', 'PLAY.md']);
/** The ones every version must have. `assets` arrives with the sprites (V2). */
export const REQUIRED_PLAY_PATHS = Object.freeze(['index.html', 'style.css', 'src', 'LICENSE', 'PLAY.md']);

const TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const EDITION_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LINK_REFERENCE_PATTERN = /^\[[^\]]+\]:\s/;

/* ---------- 2. Pure helpers ---------- */

/**
 * Reads a version tag such as "v1.0.0".
 * @param {string} tag
 * @returns {{ tag: string, version: string, major: number, minor: number, patch: number }}
 * @throws {Error} When the tag isn't v<major>.<minor>.<patch> with plain numbers.
 */
export function parseVersionTag(tag) {
    const match = TAG_PATTERN.exec(String(tag));
    if (!match) throw new Error(`"${tag}" isn't a version tag. Use v<major>.<minor>.<patch>, for example v1.0.0.`);
    const [major, minor, patch] = match.slice(1).map(Number);
    return { tag, version: `${major}.${minor}.${patch}`, major, minor, patch };
}

/**
 * The download's name, from the tag and package.json at that tag: breakaway-v<major>-<edition>.
 * @param {{ tag: string, version: string, major: number }} parsed - From parseVersionTag().
 * @param {{ version?: unknown, edition?: unknown }} packageJson
 * @returns {string}
 * @throws {Error} When the versions don't match or the edition is missing or not lowercase-with-dashes.
 */
export function getDownloadName(parsed, packageJson) {
    if (packageJson.version !== parsed.version) {
        throw new Error(`package.json at ${parsed.tag} says version ${packageJson.version}, but the tag is ${parsed.version}.`);
    }
    const { edition } = packageJson;
    if (typeof edition !== 'string' || !EDITION_PATTERN.test(edition)) {
        throw new Error(`package.json at ${parsed.tag} needs an "edition" such as "vector" (lowercase letters, digits and dashes).`);
    }
    return `breakaway-v${parsed.major}-${edition}`;
}

/**
 * The release title shown on GitHub, for example "Breakaway v1.0.0 (V1, vector)".
 * @param {{ tag: string, major: number }} parsed @param {string} edition
 * @returns {string}
 */
export function getReleaseTitle(parsed, edition) {
    return `Breakaway ${parsed.tag} (V${parsed.major}, ${edition})`;
}

/**
 * The body of one version's section in a Keep a Changelog file, without its heading.
 * @param {string} changelog - The whole CHANGELOG.md.
 * @param {string} version - For example "1.0.0".
 * @returns {string}
 * @throws {Error} When the section is missing or empty.
 */
export function extractChangelogSection(changelog, version) {
    const lines = changelog.split(/\r?\n/);
    const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
    if (start === -1) throw new Error(`CHANGELOG.md has no section for ${version}. Add "## [${version}] - <date>".`);
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => line.startsWith('## [') || LINK_REFERENCE_PATTERN.test(line));
    const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
    if (!body) throw new Error(`CHANGELOG.md's section for ${version} is empty.`);
    return body;
}

/**
 * Orders two parsed versions: negative when a is older, positive when newer.
 * @param {{ major: number, minor: number, patch: number }} a
 * @param {{ major: number, minor: number, patch: number }} b
 * @returns {number}
 */
export function compareVersions(a, b) {
    return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * True when `tag` is the highest version among `tags`. A fix to an older version (v1.0.1 after
 * v2.0.0 exists) is not, so it doesn't become the "Latest" release on GitHub.
 * @param {string} tag @param {string[]} tags - Every tag in the repo; non-version tags are ignored.
 * @returns {boolean}
 */
export function isNewestVersion(tag, tags) {
    const current = parseVersionTag(tag);
    return tags.filter((name) => TAG_PATTERN.test(name))
        .every((name) => compareVersions(parseVersionTag(name), current) <= 0);
}

/**
 * The play paths that exist at the tag.
 * @param {(path: string) => boolean} pathExists
 * @returns {string[]}
 * @throws {Error} When a required path is missing.
 */
export function selectPlayPaths(pathExists) {
    const missing = REQUIRED_PLAY_PATHS.filter((path) => !pathExists(path));
    if (missing.length > 0) throw new Error(`The tag is missing ${missing.join(', ')}, which every download needs.`);
    return PLAY_PATHS.filter((path) => pathExists(path));
}

/**
 * One line in the format `sha256sum` writes and checks: "<hash>  <file name>".
 * @param {Buffer} contents @param {string} fileName
 * @returns {string}
 */
export function sha256Line(contents, fileName) {
    return `${createHash('sha256').update(contents).digest('hex')}  ${fileName}\n`;
}

/* ---------- 3. Git helpers ---------- */

/**
 * Runs git in `repoDir` without a shell, so nothing in the arguments is ever interpreted.
 * @param {string} repoDir @param {string[]} args
 * @returns {string} Standard output.
 */
function git(repoDir, args) {
    return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** @param {string} repoDir @param {string} ref @returns {boolean} */
function doesRefExist(repoDir, ref) {
    try {
        git(repoDir, ['cat-file', '-e', ref]);
        return true;
    } catch {
        return false;
    }
}

/* ---------- 4. packageRelease ---------- */

/**
 * Builds the zip, its checksum and the release notes for one tag.
 * @param {{ tag: string, repoDir: string, outDir: string }} options
 * @returns {{ name: string, title: string, zipPath: string, checksumPath: string,
 *   notesPath: string, isLatest: boolean, paths: string[] }}
 * @throws {Error} With a message that says what to fix.
 */
export function packageRelease({ tag, repoDir, outDir }) {
    const parsed = parseVersionTag(tag);
    if (!doesRefExist(repoDir, `refs/tags/${tag}`)) {
        throw new Error(`Tag ${tag} doesn't exist here. Create it (git tag -a ${tag} -m "...") or fetch it (git fetch --tags).`);
    }
    const packageJson = JSON.parse(git(repoDir, ['show', `${tag}:package.json`]));
    const name = getDownloadName(parsed, packageJson);
    const notes = extractChangelogSection(git(repoDir, ['show', `${tag}:CHANGELOG.md`]), parsed.version);
    const paths = selectPlayPaths((path) => doesRefExist(repoDir, `${tag}:${path}`));

    mkdirSync(outDir, { recursive: true });
    const zipPath = join(outDir, `${name}.zip`);
    const checksumPath = `${zipPath}.sha256`;
    const notesPath = join(outDir, 'release-notes.md');
    rmSync(zipPath, { force: true });
    git(repoDir, ['archive', '--format=zip', `--prefix=${name}/`, '-o', zipPath, tag, '--', ...paths]);
    writeFileSync(checksumPath, sha256Line(readFileSync(zipPath), `${name}.zip`));
    writeFileSync(notesPath, `${notes}\n`);

    const tags = git(repoDir, ['tag', '--list']).split('\n').filter(Boolean);
    return {
        name,
        title: getReleaseTitle(parsed, packageJson.edition),
        zipPath,
        checksumPath,
        notesPath,
        isLatest: isNewestVersion(tag, tags),
        paths
    };
}

/* ---------- 5. Command line ---------- */

/**
 * `node scripts/package-release.mjs <tag>`. On GitHub Actions it also writes the results to
 * $GITHUB_OUTPUT so the next workflow step can use them.
 * @returns {void}
 */
function main() {
    const tag = process.argv[2];
    if (!tag) {
        console.error('Usage: npm run package -- <tag>   (for example: npm run package -- v1.0.0)');
        process.exit(2);
    }
    const repoDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
    try {
        const result = packageRelease({ tag, repoDir, outDir: join(repoDir, 'dist') });
        console.log(`${result.title}`);
        console.log(`  zip:      ${result.zipPath}`);
        console.log(`  checksum: ${result.checksumPath}`);
        console.log(`  notes:    ${result.notesPath}`);
        console.log(`  contains: ${result.paths.join(', ')}`);
        console.log(`  latest:   ${result.isLatest}`);
        if (process.env.GITHUB_OUTPUT) {
            appendFileSync(process.env.GITHUB_OUTPUT, [
                `title=${result.title}`,
                `zip=${result.zipPath}`,
                `checksum=${result.checksumPath}`,
                `notes=${result.notesPath}`,
                `is_latest=${result.isLatest}`
            ].join('\n') + '\n');
        }
    } catch (error) {
        console.error(`Couldn't package ${tag}: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
