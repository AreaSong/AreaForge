// DEP-2A：只加载现有安装包；固定小型 fixture，不加载或应用草案。
const fs = require('node:fs');
const path = require('node:path');
const out = __dirname;
const resolved = JSON.parse(fs.readFileSync(path.join(out, 'resolved-paths.json')));
const fast = require(resolved.find(x => x.name === 'fast-glob').entry);
const tiny = require(JSON.parse(fs.readFileSync(path.join(out, 'tiny-path.json'))).entry);
const fixture = fs.mkdtempSync(path.join(out, 'fixture-'));
const initialCwd = process.cwd();
const dirs = ['apps/web/app', 'apps/admin/pages', 'apps/.hidden/app', 'apps/web/.cache', 'apps/w1', 'apps/w2', 'apps/w3', 'apps/w4', 'apps/w5', 'apps/(group)', 'apps/[id]', 'apps/literal{one}', 'apps/foo,bar'];
const patterns = ['apps/web', './apps/web', 'apps/web/', 'apps/*', 'apps/**', 'apps/**/app', 'apps/.hidden', 'apps/{web,admin}', 'apps/{w1,{w2,w3}}', 'apps/w{1..5..2}', 'apps/w{01..03}', 'apps/@(web|admin)', 'apps/!(admin)', 'apps/[wa]*', 'apps/missing', 'apps/file.txt', 'apps/literal{one}', 'apps/{web,}', 'apps/{web,web}', 'apps/{web,admin', '', '!apps/admin'];
try {
  for (const dir of dirs) fs.mkdirSync(path.join(fixture, dir), { recursive: true });
  fs.writeFileSync(path.join(fixture, 'apps/file.txt'), 'fixture\n');
  fs.symlinkSync('web', path.join(fixture, 'apps/link'));
  fs.symlinkSync('absent', path.join(fixture, 'apps/broken'));
  process.chdir(fixture);
  const inputs = [...patterns, path.join(fixture, 'apps/web'), path.join(fixture, 'apps/*'), ['apps/web', 'apps/*']];
  const observations = inputs.map(pattern => {
    const run = (lib, options) => { try { return { result: lib.globSync(pattern, options) }; } catch(e) { return { error: { name: e.name, message: e.message } }; } };
    return { pattern, fast: run(fast, { onlyDirectories: true }), tiny: run(tiny, { onlyDirectories: true, expandDirectories: false, debug: false }), tinyAbsolute: typeof pattern === 'string' && path.isAbsolute(pattern) ? run(tiny, { onlyDirectories: true, expandDirectories: false, absolute: true, debug: false }) : undefined };
  });
  fs.writeFileSync(path.join(out, 'glob-observations.json'), JSON.stringify({ node: process.version, platform: process.platform, fixtureDirectories: dirs, observations }, null, 2) + '\n');
  console.log(JSON.stringify(observations, null, 2));
} finally {
  process.chdir(initialCwd);
  fs.rmSync(fixture, { recursive: true, force: true });
}
