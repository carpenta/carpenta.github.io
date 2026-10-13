import { realpathSync } from 'node:fs';
import { access, cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED = [
  'index.html',
  'en/index.html',
  '404.html',
  'tools/index.html',
  'en/tools/index.html',
];

/** 이력서는 로컬 전용이다. 배포 결과물에는 들어가면 안 된다. */
export const PRIVATE = ['resume', 'en/resume'];

const exists = (path) => access(path).then(() => true, () => false);

async function dirs(path) {
  if (!(await exists(path))) return [];
  return (await readdir(path, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
}

/** site/dist를 out으로 복사하고, tools/<slug>/dist를 out/tools/<slug>/로 복사한다. */
export async function assemble({ root, out }) {
  const siteDist = join(root, 'site/dist');
  if (!(await exists(join(siteDist, 'index.html')))) {
    throw new Error('site/dist/index.html not found. Build the site first.');
  }
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await cp(siteDist, out, { recursive: true });
  for (const path of PRIVATE) await rm(join(out, path), { recursive: true, force: true });

  for (const slug of await dirs(join(root, 'tools'))) {
    const toolDist = join(root, 'tools', slug, 'dist');
    if (!(await exists(join(toolDist, 'index.html')))) continue;
    const target = join(out, 'tools', slug);
    if (await exists(target)) {
      throw new Error(`tools/${slug} collides with a static tool of the same name in site/public/tools/${slug}`);
    }
    await cp(toolDist, target, { recursive: true });
  }
}

/** 등록부와 결과물을 대조한다. 문제 설명의 배열을 돌려주며, 비어 있으면 통과다. */
export async function verify({ out, slugs }) {
  const problems = [];
  for (const file of REQUIRED) {
    if (!(await exists(join(out, file)))) problems.push(`missing required file: ${file}`);
  }
  for (const path of PRIVATE) {
    if (await exists(join(out, path))) problems.push(`private path must not be deployed: ${path}/`);
  }
  for (const slug of slugs) {
    if (!(await exists(join(out, 'tools', slug, 'index.html')))) {
      problems.push(`registered tool has no output: tools/${slug}/index.html`);
    }
  }
  for (const slug of await dirs(join(out, 'tools'))) {
    if (!slugs.includes(slug)) problems.push(`tool folder is not registered in tools.json: tools/${slug}/`);
  }
  for (const slug of slugs) {
    const page = join(out, 'tools', slug, 'index.html');
    if (!(await exists(page))) continue;
    for (const url of rootAbsoluteAssets(await readFile(page, 'utf8'))) {
      problems.push(`tool page loads an asset from the site root: tools/${slug}/index.html -> ${url}`);
    }
  }
  return problems;
}

/**
 * <script src> 와 <link href> 중 "/"로 시작하는(루트 절대) 주소를 모은다. "//", http:, data:, ./, ../, 맨 상대 경로는 통과.
 * 태그 단위 정규식이라 주석 안의 태그, 속성값 안의 ">", 따옴표 없는 값 속의 공백은 처리하지 못한다.
 */
function rootAbsoluteAssets(html) {
  const found = [];
  for (const [, name, attrs] of html.matchAll(/<(script|link)\b([^>]*)>/gi)) {
    const attr = name.toLowerCase() === 'script' ? 'src' : 'href';
    const match = attrs.match(new RegExp(`(?:^|\\s)${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'));
    const url = match && (match[1] ?? match[2] ?? match[3]);
    if (url && url.startsWith('/') && !url.startsWith('//')) found.push(url);
  }
  return found;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const out = join(root, 'dist');
  const registry = JSON.parse(await readFile(join(root, 'site/src/data/tools.json'), 'utf8'));
  await assemble({ root, out });
  const problems = await verify({ out, slugs: registry.map((tool) => tool.slug) });
  if (problems.length > 0) {
    for (const problem of problems) console.error(`✗ ${problem}`);
    process.exit(1);
  }
  console.log(`assembled dist/ with ${registry.length} tool(s)`);
}
