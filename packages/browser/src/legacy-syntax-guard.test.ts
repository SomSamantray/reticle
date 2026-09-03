/**
 * Webpack 4 cannot parse nullish coalescing, optional chaining, or logical assignment, and
 * react-scripts 4 excludes node_modules from Babel — so any of those tokens in the published
 * SDK dist breaks the app's compile before a session can connect (issue #680). The browser and
 * core packages pin `target: ES2017` in their own tsconfigs for exactly this reason. This file
 * fails if that pin is removed or if newer syntax reaches dist again.
 */
// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const BROWSER_DIST = join(HERE, '..', 'dist');
const CORE_DIST = join(HERE, '..', '..', 'core', 'dist');

function jsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...jsFiles(full));
    } else if (/\.(?:js|cjs|mjs)$/.test(full) && !full.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

function stripNonCode(src: string): string {
  return stripTemplates(
    src
      // block comments, line comments, single/double-quoted strings
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ')
      .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, '""'),
  );
}

/**
 * Blanks template-literal text but keeps ${} interpolation contents: an operator inside an
 * interpolation is code webpack 4 must parse, while one in literal text is inert.
 */
function stripTemplates(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const start = src.indexOf('`', i);
    if (-1 === start) return out + src.slice(i);
    out += src.slice(i, start);
    // Collect the literal's ${...} spans verbatim; everything else cooked text is blanked.
    let kept = '';
    let j = start + 1;
    while (j < src.length) {
      if ('\\' === src[j]) {
        j += 2;
        continue;
      }
      if ('`' === src[j]) break;
      if ('$' === src[j] && '{' === src[j + 1]) {
        let depth = 1;
        let m = j + 2;
        while (m < src.length && 0 < depth) {
          if ('\\' === src[m]) {
            m += 2;
            continue;
          }
          if ('$' === src[m] && '{' === src[m + 1]) depth += 1;
          else if ('}' === src[m]) depth -= 1;
          m += 1;
        }
        kept += src.slice(j, m);
        j = m;
        continue;
      }
      j += 1;
    }
    out += `""${kept}""`;
    i = j + 1;
  }
  return out;
}

const MODERN_SYNTAX_TOKENS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: '??=', re: /\?\?=/ },
  { name: '||=', re: /\|\|=/ },
  { name: '&&=', re: /&&=/ },
  { name: '??', re: /\?\?/ },
  { name: '?.', re: /\?\.(?![0-9])/ },
];

function scanDistForModernSyntax(dir: string): string[] {
  const hits: string[] = [];
  for (const file of jsFiles(dir)) {
    const code = stripNonCode(readFileSync(file, 'utf8'));
    for (const token of MODERN_SYNTAX_TOKENS) {
      if (token.re.test(code)) hits.push(`${file}: ${token.name}`);
    }
  }
  return hits;
}

describe('published SDK dist stays parseable by webpack 4', () => {
  it.each([
    ['browser', BROWSER_DIST],
    ['core', CORE_DIST],
  ] as const)(
    '%s dist carries no nullish, optional-chain, or logical-assignment syntax',
    (pkg, dist) => {
      expect(existsSync(dist), `${pkg} dist is missing — run pnpm build before test:unit`).toBe(
        true,
      );
      expect(
        jsFiles(dist).length,
        `${pkg} dist holds no scannable files — the guard would pass vacuously`,
      ).toBeGreaterThan(0);
      expect(scanDistForModernSyntax(dist)).toEqual([]);
    },
  );

  it('the scanner sees through comments and strings to code-position tokens', () => {
    // A fixture, not dist: proves the guard is red-capable without depending on a broken build.
    const fixture = [
      '// `??` in a comment and "??" in a string are fine',
      '/* ??= in a block comment */',
      "const s = '?. decoy';",
      'const label = `did you mean ${s} ?? half`;',
      'const chosen = a ?? b;',
      'const el = maybe?.child;',
      'const msg = `value ${a ?? b}`;',
      'opts.retry ??= 3;',
      'opts.count ||= 1;',
      'opts.flag &&= ready;',
    ].join('\n');
    const code = stripNonCode(fixture);
    expect(
      MODERN_SYNTAX_TOKENS.filter((t) => t.re.test(code))
        .map((t) => t.name)
        .sort(),
    ).toEqual(['&&=', '?.', '??', '??=', '||=']);
  });

  it.each(['browser', 'core'] as const)('%s resolves a target at or below ES2017', (pkg) => {
    const base = JSON.parse(
      readFileSync(join(HERE, '..', '..', '..', 'tsconfig.base.json'), 'utf8'),
    ) as { compilerOptions?: { target?: string } };
    const config = JSON.parse(
      readFileSync(join(HERE, '..', '..', pkg, 'tsconfig.json'), 'utf8'),
    ) as { compilerOptions?: { target?: string } };
    const resolved = (
      config.compilerOptions?.target ??
      base.compilerOptions?.target ??
      ''
    ).toLowerCase();
    expect(
      ['es3', 'es5', 'es2015', 'es2016', 'es2017'].includes(resolved),
      `${pkg} resolves target ${resolved || '(unset)'} — the webpack-4 pin must stay at ES2017 or below`,
    ).toBe(true);
  });
});
