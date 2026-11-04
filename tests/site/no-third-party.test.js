// The game page must load nothing from other origins and use no network APIs (AC-1.10, AC-17).
// Troubleshooting: a failure names the file and the matched text. Remove the URL or API, or, for the
// SVG namespace string only, it is already allowed (it names a standard, it is not fetched).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, extname, dirname, resolve as resolvePath, basename } from 'node:path';
import { GAME_DIR, listFiles, stripComments, toPosix, relative } from './site-helpers.js';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/** Game files shipped to the browser: index.html, style.css and everything in src. */
function shippedFiles() {
    const files = [join(GAME_DIR, 'index.html'), join(GAME_DIR, 'style.css'), ...listFiles(join(GAME_DIR, 'src'))];
    return files.map((file) => {
        const ext = extname(file);
        const kind = ext === '.html' ? 'html' : ext === '.css' ? 'css' : 'js';
        return { name: toPosix(relative(GAME_DIR, file)), kind, code: stripComments(readFileSync(file, 'utf8'), kind) };
    });
}

describe('game page third-party isolation', () => {
    const files = shippedFiles();

    it('has files to scan (index.html, style.css and src modules)', () => {
        assert.ok(files.length >= 3, `only ${files.length} files found`);
        assert.ok(files.some((f) => f.name === 'index.html'));
        assert.ok(files.some((f) => f.name === 'style.css'));
    });

    it('contains no http or https URL other than the SVG namespace', () => {
        for (const file of files) {
            const urls = (file.code.match(/https?:\/\/[^\s"'`)<>]+/gi) ?? []).filter((u) => u !== SVG_NAMESPACE);
            assert.deepEqual(urls, [], `${file.name} references external URLs`);
        }
    });

    it('contains no protocol-relative URL in markup or styles', () => {
        for (const file of files.filter((f) => f.kind !== 'js')) {
            const hits = file.code.match(/(?:src|href|url\()\s*=?\s*["']?\/\/[^\s"')]+/gi) ?? [];
            assert.deepEqual(hits, [], `${file.name} has protocol-relative URLs`);
        }
    });

    it('does not use network, injection or iframe APIs', () => {
        const banned = [
            [/\bfetch\s*\(/, 'fetch('],
            [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
            [/\bsendBeacon\b/, 'sendBeacon'],
            [/\bnew\s+WebSocket\b/, 'WebSocket'],
            [/\bEventSource\b/, 'EventSource'],
            [/\beval\s*\(/, 'eval('],
            [/\bnew\s+Function\b/, 'new Function'],
            [/\bdocument\.write\b/, 'document.write'],
            [/<iframe\b/i, '<iframe'],
            [/@import\b/, '@import'],
            [/importScripts\s*\(/, 'importScripts(']
        ];
        for (const file of files) {
            for (const [pattern, label] of banned) {
                assert.doesNotMatch(file.code, pattern, `${file.name} uses ${label}`);
            }
        }
    });

    it('loads scripts and stylesheets only from relative paths', () => {
        const html = files.find((f) => f.name === 'index.html').code;
        const refs = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*"([^"]*)"/gi)].map((m) => m[1]);
        assert.ok(refs.length > 0, 'no script or link tags found');
        for (const ref of refs) {
            assert.doesNotMatch(ref, /^(?:[a-z]+:)?\/\//i, `index.html loads ${ref}`);
        }
    });

    it('never writes untrusted markup with innerHTML, outerHTML or insertAdjacentHTML from a variable', () => {
        for (const file of files.filter((f) => f.kind === 'js')) {
            // Allowed: assigning an empty or string-literal value. Anything else is listed for review.
            const hits = [...file.code.matchAll(/\.(?:innerHTML|outerHTML)\s*=\s*([^;\n]+)|insertAdjacentHTML\s*\(([^)]*)\)/g)]
                .map((m) => (m[1] ?? m[2]).trim())
                .filter((arg) => !/^(['"`])(?:(?!\$\{)[^\\]|\\.)*?\1$/.test(arg.replace(/^[^,]*,\s*/, '')));
            assert.deepEqual(hits, [], `${file.name} sets HTML from a non-literal value`);
        }
    });
});

describe('game page import hygiene (GitHub Pages is case-sensitive)', () => {
    it('imports only relative .js modules that exist with exact case', () => {
        const jsFiles = listFiles(join(GAME_DIR, 'src')).filter((f) => f.endsWith('.js'));
        assert.ok(jsFiles.length > 0, 'no src modules found');
        for (const file of jsFiles) {
            const code = stripComments(readFileSync(file, 'utf8'), 'js');
            const specs = [...code.matchAll(/(?:^|\s)(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s*['"]([^'"]+)['"]/gm)]
                .map((m) => m[1] ?? m[2] ?? m[3]);
            for (const spec of specs) {
                const name = toPosix(relative(GAME_DIR, file));
                assert.match(spec, /^\.\.?\//, `${name} imports non-relative "${spec}"`);
                assert.ok(spec.endsWith('.js'), `${name} import "${spec}" lacks .js`);
                const target = resolvePath(dirname(file), spec);
                assert.ok(existsSync(target), `${name} imports missing file "${spec}"`);
                assert.ok(readdirSync(dirname(target)).includes(basename(target)), `${name} import "${spec}" differs in letter case`);
            }
        }
    });

    it('uses no root-absolute URLs in index.html or style.css', () => {
        for (const name of ['index.html', 'style.css']) {
            const code = stripComments(readFileSync(join(GAME_DIR, name), 'utf8'), name.endsWith('.css') ? 'css' : 'html');
            const hits = code.match(/(?:src|href)\s*=\s*"\/(?!\/)[^"]*"|url\(\s*["']?\/(?!\/)[^)]*\)/gi) ?? [];
            assert.deepEqual(hits, [], `${name} uses root-absolute paths`);
        }
    });

    it('script tags in index.html point at files that exist', () => {
        const html = readFileSync(join(GAME_DIR, 'index.html'), 'utf8');
        for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*"([^"]+)"/gi)) {
            assert.ok(existsSync(join(GAME_DIR, m[1])), `index.html script src ${m[1]} does not exist`);
        }
    });
});
