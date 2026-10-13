import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { access } from 'node:fs/promises';
import { afterEach, beforeEach, test } from 'node:test';
import { PRIVATE, REQUIRED, assemble, verify } from './assemble.mjs';

let root;
const exists = (path) => access(path).then(() => true, () => false);

async function put(path, body = 'x') {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), body);
}

async function fixture() {
  for (const file of REQUIRED) await put(`site/dist/${file}`, `site:${file}`);
  await put('site/dist/resume/index.html', 'resume');
  await put('site/dist/resume/x.pdf', 'pdf');
  await put('site/dist/en/resume/index.html', 'resume-en');
  await put('site/dist/tools/static-tool/index.html', 'static');
  await put('tools/folio/dist/index.html', 'folio');
  await put('tools/folio/dist/assets/app.js', 'js');
  await put('tools/folio/src/main.ts', 'source');
}

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'assemble-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test('assemble merges the site and each built tool under tools/<slug>/', async () => {
  await fixture();
  await assemble({ root, out: join(root, 'dist') });
  assert.equal(await readFile(join(root, 'dist/index.html'), 'utf8'), 'site:index.html');
  assert.equal(await readFile(join(root, 'dist/tools/folio/index.html'), 'utf8'), 'folio');
  assert.equal(await readFile(join(root, 'dist/tools/folio/assets/app.js'), 'utf8'), 'js');
  assert.equal(await readFile(join(root, 'dist/tools/static-tool/index.html'), 'utf8'), 'static');
  await assert.rejects(readFile(join(root, 'dist/tools/folio/src/main.ts')));
});

test('assemble leaves the private résumé paths out of the output', async () => {
  await fixture();
  await assemble({ root, out: join(root, 'dist') });
  assert.deepEqual(PRIVATE, ['resume', 'en/resume']);
  await readFile(join(root, 'dist/index.html'));
  await readFile(join(root, 'dist/en/index.html'));
  for (const path of ['dist/resume', 'dist/resume/index.html', 'dist/resume/x.pdf', 'dist/en/resume', 'dist/en/resume/index.html']) {
    assert.equal(await exists(join(root, path)), false, path);
  }
});

test('assemble succeeds when the site has no résumé directories', async () => {
  await fixture();
  await rm(join(root, 'site/dist/resume'), { recursive: true });
  await rm(join(root, 'site/dist/en/resume'), { recursive: true });
  await assemble({ root, out: join(root, 'dist') });
  assert.deepEqual(await verify({ out: join(root, 'dist'), slugs: ['folio', 'static-tool'] }), []);
});

test('verify reports a résumé page that was put into the output by hand', async () => {
  await fixture();
  await assemble({ root, out: join(root, 'dist') });
  await put('dist/resume/index.html', 'oops');
  const problems = await verify({ out: join(root, 'dist'), slugs: ['folio', 'static-tool'] });
  assert.deepEqual(problems, ['private path must not be deployed: resume/']);
});

test('assemble starts from an empty output directory', async () => {
  await fixture();
  await put('dist/stale.html', 'old');
  await assemble({ root, out: join(root, 'dist') });
  await assert.rejects(readFile(join(root, 'dist/stale.html')));
});

test('assemble refuses a built tool that would overwrite a static tool', async () => {
  await fixture();
  await put('site/dist/tools/folio/index.html', 'clash');
  await assert.rejects(assemble({ root, out: join(root, 'dist') }), /folio/);
});

test('assemble fails clearly when the site has not been built', async () => {
  await put('tools/folio/dist/index.html', 'folio');
  await assert.rejects(assemble({ root, out: join(root, 'dist') }), /site\/dist/);
});

test('verify passes when the output matches the registry', async () => {
  await fixture();
  await assemble({ root, out: join(root, 'dist') });
  assert.deepEqual(await verify({ out: join(root, 'dist'), slugs: ['folio', 'static-tool'] }), []);
});

test('verify reports a registered tool with no output', async () => {
  await fixture();
  await assemble({ root, out: join(root, 'dist') });
  const problems = await verify({ out: join(root, 'dist'), slugs: ['folio', 'static-tool', 'ghost'] });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /ghost/);
});

test('verify reports a tool folder that is not registered', async () => {
  await fixture();
  await assemble({ root, out: join(root, 'dist') });
  const problems = await verify({ out: join(root, 'dist'), slugs: ['folio'] });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /static-tool/);
});

test('verify reports a missing required page', async () => {
  await fixture();
  await rm(join(root, 'site/dist/en/index.html'));
  await assemble({ root, out: join(root, 'dist') });
  const problems = await verify({ out: join(root, 'dist'), slugs: ['folio', 'static-tool'] });
  assert.deepEqual(problems, ['missing required file: en/index.html']);
});

async function cliFixture(slugs) {
  await mkdir(join(root, 'real'));
  const real = join(root, 'real');
  const saved = root;
  // reuse put/fixture by pointing them at real/
  root = real;
  await fixture();
  await mkdir(join(real, 'scripts'), { recursive: true });
  await copyFile(new URL('./assemble.mjs', import.meta.url), join(real, 'scripts/assemble.mjs'));
  await put('site/src/data/tools.json', JSON.stringify(slugs.map((slug) => ({ slug }))));
  root = saved;
  await symlink(real, join(root, 'link'));
  return spawnSync(process.execPath, [join(root, 'link/scripts/assemble.mjs')], { encoding: 'utf8' });
}

test('cli runs and succeeds when invoked through a symlinked path', async () => {
  const result = await cliFixture(['folio', 'static-tool']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /assembled dist\/ with/);
  await readFile(join(root, 'real/dist/index.html'));
});

test('cli exits non-zero and names a registered tool without output when invoked through a symlink', async () => {
  const result = await cliFixture(['folio', 'static-tool', 'ghost']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ghost/);
});

async function verifyToolPage(html) {
  await fixture();
  await put('tools/folio/dist/index.html', html);
  await assemble({ root, out: join(root, 'dist') });
  return verify({ out: join(root, 'dist'), slugs: ['folio', 'static-tool'] });
}

test('verify reports a tool page whose script loads from the site root', async () => {
  const problems = await verifyToolPage('<html><head><script type="module" crossorigin src="/assets/app.js"></script></head></html>');
  assert.deepEqual(problems, ['tool page loads an asset from the site root: tools/folio/index.html -> /assets/app.js']);
});

test('verify reports a tool page whose stylesheet loads from the site root', async () => {
  const problems = await verifyToolPage(`<link href='/style.css' rel='stylesheet'>`);
  assert.deepEqual(problems, ['tool page loads an asset from the site root: tools/folio/index.html -> /style.css']);
});

test('verify accepts relative, external and protocol-relative assets and root anchors', async () => {
  const problems = await verifyToolPage([
    '<script type="module" src="./assets/app.js"></script>',
    '<script src="https://example.com/x.js"></script>',
    '<script src="//cdn.example/x.js"></script>',
    '<script src="../shared.js"></script>',
    '<script src="assets/bare.js"></script>',
    '<link rel="icon" href="data:,">',
    '<a href="/">site</a>',
  ].join('\n'));
  assert.deepEqual(problems, []);
});
