// 固定单分支边界与真实消费者回归；显式绑定候选与排他输出，禁止无界 PoC。
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { root, fixtureRoot, sha, consumerNames, parseArgs, validateBaseline, loadInputs,
  validateOutput, reserveOutput, stamp, save, compatibility } = require('./braces-depth-inputs.cjs');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function scriptIdentity() {
  return [__filename, path.join(__dirname, 'braces-depth-inputs.cjs')].map(file => ({ file, sha256: sha(fs.readFileSync(file)) }));
}

function modules() {
  let req = createRequire(path.join(root, 'apps/web/package.json'));
  const chain = [];
  for (const name of consumerNames) {
    const entry = req.resolve(name);
    chain.push({ name, entry, realpath: fs.realpathSync(entry), sha256: sha(fs.readFileSync(entry)) });
    req = createRequire(entry);
  }
  const plugin = chain[1].entry;
  const bracesEntry = chain[4].entry;
  return { chain, braces: require(bracesEntry), micro: require(chain[3].entry),
    plugin: require(plugin), getRootDirs: require(path.join(path.dirname(plugin), 'utils/get-root-dirs.js')).getRootDirs,
    Linter: createRequire(plugin)('eslint').Linter, bracesDir: path.dirname(bracesEntry) };
}

function fixture(out) {
  const dir = fs.mkdtempSync(path.join(out, 'fixture-'));
  const dirs = ['apps/web/pages', 'apps/web/src/pages', 'apps/web/app', 'apps/web/src/app',
    'apps/admin/pages', 'apps/src-only/src/app', 'apps/app-only/app', 'apps/.hidden/app', 'apps/web/.cache', 'apps/empty', 'different',
    'apps/w1', 'apps/w2', 'apps/w3', 'apps/w4', 'apps/w5', 'apps/(group)', 'apps/[id]', 'apps/literal{one}', 'apps/foo,bar'];
  dirs.forEach(d => fs.mkdirSync(path.join(dir, d), { recursive: true }));
  const pages = ['pages/from-pages.tsx', 'src/pages/from-src-pages.tsx', 'app/page.tsx', 'src/app/other.tsx'];
  pages.forEach(f => fs.writeFileSync(path.join(dir, 'apps/web', f), 'export default function Page() { return null; }\n'));
  ['apps/src-only/src/app/page.tsx', 'apps/app-only/app/page.tsx'].forEach(f => fs.writeFileSync(path.join(dir, f), 'export default function Page() { return null; }\n'));
  fs.writeFileSync(path.join(dir, 'apps/file.txt'), 'fixture\n');
  fs.symlinkSync('web', path.join(dir, 'apps/link'));
  fs.symlinkSync('absent', path.join(dir, 'apps/broken'));
  return dir;
}

function normalCases(inputs = json(path.join(fixtureRoot, 'patterns.json'))) {
  const patterns = ['apps/web', './apps/web', 'apps/web/', 'apps/*', 'apps/**', 'apps/**/app',
    'apps/.hidden', 'apps/{web,admin}', 'apps/{w1,{w2,w3}}', 'apps/w{1..5..2}', 'apps/w{01..03}',
    'apps/@(web|admin)', 'apps/!(admin)', 'apps/[wa]*', 'apps/missing', 'apps/file.txt',
    'apps/literal{one}', 'apps/{web,}', 'apps/{web,web}', 'apps/{web,admin', '!apps/admin', '',
    '$FIX/apps/web', '$FIX/apps/*', 'apps\\web', 'apps/link', 'apps/broken',
    ['apps/web', 'apps/*'], ['apps/*', '!apps/admin'], ['apps/web', 'apps/web'],
    [null, 7, {}, 'apps/web'], [], undefined];
  const cases = patterns.map((input, i) => ({ id: `root-${i}`, kind: 'roots', input, expected: input === '' ? 'TypeError' : 'ok' }));
  inputs.forEach((pattern, i) => cases.push({ id: `expand-${i}`, kind: 'normal-braces', input: pattern, expected: 'ok' }));
  for (const [name, input] of [['default', undefined], ['string', 'apps/web'], ['array', ['apps/web', 42]],
    ['duplicates', ['apps/web', 'apps/web']], ['src-app', 'apps/src-only'], ['app', 'apps/app-only'], ['empty', 'apps/empty'], ['no-roots', 'apps/missing']]) {
    cases.push({ id: `lint-${name}`, kind: 'lint', input, expected: 'ok' });
  }
  return cases;
}

function nest(depth, form) {
  const opens = Array.from({ length: depth }, (_, i) => form === 'paren' ? '(' : form === 'mixed' && i % 2 ? '(' : '{');
  const closes = opens.slice().reverse().map(c => c === '(' ? ')' : '}').join('');
  if (form === 'escaped') return '\\{'.repeat(depth) + 'x' + '\\}'.repeat(depth);
  if (form === 'quoted') return '"' + opens.join('') + 'x' + closes + '"';
  return opens.join('') + 'x' + (form === 'unclosed' ? '' : closes);
}

function depthCases() {
  const cases = [];
  const add = (method, depth, form, opts = {}, expected, astRoot = true) => cases.push({
    id: `${method}-${form}-${depth}-${String(opts.maxDepth)}-${astRoot}-${Boolean(opts.escapeInvalid)}`,
    kind: 'depth', method, depth, form, opts, astRoot,
    expected: expected || (depth > 100 ? method === 'parse' ? 'SyntaxError' : 'RangeError' : 'ok') });
  for (const depth of [99, 100, 101]) {
    for (const form of ['brace', 'paren', 'mixed', 'unclosed']) add('parse', depth, form);
    for (const form of ['escaped', 'quoted']) add('parse', depth, form, {}, 'ok');
    for (const method of ['compile', 'expand', 'stringify']) {
      for (const astRoot of [true, false]) add(method, depth, 'ast', {}, undefined, astRoot);
    }
  }
  for (const method of ['parse', 'compile', 'expand', 'stringify']) {
    const form = method === 'parse' ? 'mixed' : 'ast';
    const error = method === 'parse' ? 'SyntaxError' : 'RangeError';
    for (const depth of [1, 2, 3]) add(method, depth, form, { maxDepth: 2 }, depth > 2 ? error : 'ok');
    for (const maxDepth of ['Infinity', 'NaN', 1e9]) {
      add(method, 100, form, { maxDepth }, 'ok'); add(method, 101, form, { maxDepth }, error);
    }
    add(method, 100, form, { escapeInvalid: true }, 'ok');
    add(method, 101, form, { escapeInvalid: true }, error);
  }
  for (const [id, method, input, opts, expected] of [
    ['length-at', 'parse', 'x'.repeat(10000), {}, 'ok'], ['length-over', 'parse', 'x'.repeat(10001), {}, 'SyntaxError'],
    ['length-low', 'parse', 'xxxx', { maxLength: 3 }, 'SyntaxError'],
    ['range-at', 'expand', '{1..1000}', {}, 'ok'], ['range-over', 'expand', '{1..1001}', {}, 'RangeError'],
    ['range-low', 'expand', '{1..4}', { rangeLimit: 3 }, 'RangeError']]) {
    cases.push({ id, kind: 'limit', method, input, opts, expected });
  }
  cases.push({ id: 'lint-over-limit', kind: 'lint', input: nest(101, 'brace') + '/apps/*', expected: 'SyntaxError' });
  cases.push({ id: 'lint-mixed-roots-over-limit', kind: 'lint', input: ['apps/web', nest(101, 'brace') + '/apps/*'], expected: 'SyntaxError' });
  cases.push({ id: 'lint-uncaught-over-limit', kind: 'lint', input: nest(101, 'brace') + '/apps/*', uncaught: true, expected: 'uncaught-SyntaxError' });
  return cases;
}

// root 不计层；每个含 nodes 的容器计一层，叶节点不增加深度。每个 AST 都重新构造。
function ast(depth, withRoot) {
  let node = { type: 'text', value: 'x' };
  for (let i = 0; i < depth; i++) {
    const parent = { type: 'paren', nodes: [node] };
    node.parent = parent; node = parent;
  }
  if (!withRoot) return node;
  const parent = { type: 'root', nodes: [node] };
  node.parent = parent;
  return parent;
}

const source = '<>\n<a href="/from-pages">p</a>\n<a href="/from-src-pages">sp</a>\n<a href="/">a</a>\n<a href="/other">sa</a>\n<a href="https://example.invalid/from-pages">external</a>\n<Link href="/from-pages">link</Link>\n<a target="_blank" href="/from-pages">blank</a>\n<a download href="/from-pages">download</a>\n<a href="//example.invalid/x">protocol</a>\n<a href={variable}>dynamic</a>\n</>';
function lint(m, c, dir, input) {
  const linter = new m.Linter({ cwd: path.join(dir, 'apps/web') });
  const messages = linter.verify(source, [{ files: ['**/*.jsx'], languageOptions: {
    ecmaVersion: 2022, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { '@next/next': m.plugin }, settings: { next: { rootDir: input } },
    rules: { '@next/next/no-html-link-for-pages': 'error' } }], { filename: 'fixture.jsx' });
  return messages.map(({ line, ruleId, message, severity, fatal }) => ({ line, ruleId, message, severity, fatal: !!fatal }));
}

function runCase(m, c, dir) {
  const input = typeof c.input === 'string' ? c.input.replaceAll('$FIX', dir) : c.input;
  if (c.kind === 'roots') return m.getRootDirs({ cwd: path.join(dir, 'different'), settings: { next: { rootDir: input } } });
  if (c.kind === 'lint') return lint(m, c, dir, input);
  if (c.kind === 'normal-braces') return { expanded: m.micro.braces(input, { expand: true, nodupes: true }),
    compiled: m.braces.compile(input), stringify: m.braces.stringify(m.braces.parse(input), { escapeInvalid: true }) };
  const opts = { ...c.opts };
  if (opts.maxDepth === 'Infinity') opts.maxDepth = Infinity;
  if (opts.maxDepth === 'NaN') opts.maxDepth = NaN;
  const value = c.kind === 'limit' ? input : c.form === 'ast' ? ast(c.depth, c.astRoot) : nest(c.depth, c.form);
  const result = m.braces[c.method](value, opts);
  return c.method === 'parse' ? { type: result.type, accepted: true } : result;
}

function child(args) {
  const options = parseArgs(args);
  const inputs = loadInputs(options);
  const context = JSON.parse(fs.readFileSync(0, 'utf8'));
  assert.deepEqual(inputs.binding, context.binding, '子进程输入绑定漂移');
  assert.deepEqual(scriptIdentity(), context.scripts, '子进程脚本漂移');
  assert.deepEqual(stamp(options.output), context.outputStamp, '子进程输出绑定漂移');
  assert.equal(path.dirname(context.dir), options.output);
  assert.deepEqual(stamp(context.dir), context.fixtureStamp, '测试目录身份漂移');
  assert.ok(['normal', 'depth'].includes(context.phase));
  assert.ok(context.phase !== 'depth' || options.mode === 'verify-patched', '旧包模式禁止深度测试');
  const cases = context.phase === 'normal' ? normalCases(inputs.patterns) : depthCases();
  assert.ok(Number.isInteger(context.index) && context.index >= 0 && context.index < cases.length);
  const c = cases[context.index];
  const m = modules();
  assert.deepEqual(identity(m, inputs.manifest, options.mode), context.identity, '子进程实际身份漂移');
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  process.chdir(context.dir);
  const execute = () => runCase(m, c, context.dir);
  let body;
  try {
    if (c.uncaught) { execute(); return; }
    try { body = { result: execute(), warnings }; }
    catch (e) { body = { error: { name: e.name, message: e.message }, warnings }; }
  } finally {
    assert.deepEqual(identity(m, inputs.manifest, options.mode), context.identity, '子进程结束身份漂移');
    assert.deepEqual(loadInputs(options).binding, context.binding, '子进程结束输入漂移');
  }
  console.log(JSON.stringify(body));
}

function classify(p) {
  const stderr = p.stderr || '';
  if (p.error?.code === 'ETIMEDOUT') return { category: 'timeout' };
  if (/heap out of memory|allocation failed|Reached heap limit/i.test(stderr)) return { category: 'OOM' };
  if (/Maximum call stack size exceeded/.test(stderr + p.stdout)) return { category: 'native-stack-exhaustion' };
  if (p.status !== 0 || p.signal) return { category: /SyntaxError:.*exceeds max depth/.test(stderr) ? 'uncaught-SyntaxError' : 'process-failure' };
  try {
    const body = JSON.parse(p.stdout);
    return { category: body.error?.name || 'ok', ...body };
  } catch { return { category: 'invalid-child-output', stdout: p.stdout }; }
}

// 只替换实际测试根；不解析、排序、去重或折叠相对路径。
function normalize(value, dir) {
  if (typeof value === 'string') return value.replaceAll(dir, '$FIX');
  if (Array.isArray(value)) return value.map(v => normalize(v, dir));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v, dir)]));
  return value;
}

function collect(cases, context, args) {
  return cases.map((c, index) => {
    const start = Date.now();
    const p = spawnSync(process.execPath, ['--max-old-space-size=128', __filename, '--child', ...args],
      { input: JSON.stringify({ ...context, index }), encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
        env: { ...process.env, NODE_OPTIONS: '', NODE_DISABLE_COMPILE_CACHE: '1' } });
    const record = { case: c, exitCode: p.status, signal: p.signal, durationMs: Date.now() - start, stderr: p.stderr, ...classify(p) };
    return normalize(record, context.dir);
  });
}

function identity(m, manifest, mode) {
  assert.deepEqual(m.chain.map(({ name, sha256 }) => ({ name, sha256 })), manifest.consumerChain, '真实消费链摘要不符');
  const files = [...manifest.files.map(f => ({ file: f.file, expected: mode === 'record-before' ? f.beforeSha256 : f.afterSha256 })),
    ...manifest.unchangedFiles.map(f => ({ file: f.file, expected: f.sha256 }))].map(f => {
    const file = path.join(m.bracesDir, f.file);
    const hash = sha(fs.readFileSync(file));
    assert.equal(hash, f.expected, `安装${mode === 'record-before' ? '原像' : '后像'}不符: ${f.file}`);
    const loaded = Boolean(require.cache[file]);
    if (f.file !== 'package.json') assert.equal(loaded, true, `实际消费链未加载: ${f.file}`);
    return { file, sha256: hash, expected: f.expected, loaded };
  });
  const pkg = json(path.join(m.bracesDir, 'package.json'));
  assert.equal(pkg.name, manifest.package); assert.equal(pkg.version, manifest.version);
  return { chain: m.chain, files, package: { name: pkg.name, version: pkg.version, dependencies: pkg.dependencies },
    node: process.version, platform: process.platform, arch: process.arch };
}

function failuresFor(normal, depth, baseline) {
  const failures = [...normal, ...depth].filter(r => r.category !== r.case.expected);
  for (const r of normal.filter(r => r.case.kind === 'lint')) {
    const empty = ['lint-empty', 'lint-no-roots'].includes(r.case.id);
    const lines = (r.result || []).map(v => v.line);
    // app 路由根 page.tsx 单独验证，避免把旧规则对普通文件名的行为当成新回归。
    const expectedLines = empty ? [] : ['lint-src-app', 'lint-app'].includes(r.case.id) ? [4] : [2, 3, 4];
    if (JSON.stringify(lines) !== JSON.stringify(expectedLines) || r.warnings?.length !== (empty ? 1 : 0)) {
      failures.push({ id: r.case.id, category: 'rule-contract', lines, warnings: r.warnings });
    }
  }
  return baseline === undefined ? failures : failures.concat(compatibility(normal, baseline));
}

function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  validateOutput(options.output);
  const inputs = loadInputs(options);
  const cases = normalCases(inputs.patterns);
  if (options.mode === 'verify-patched') validateBaseline(inputs.baseline, JSON.parse(JSON.stringify(cases)));
  const id = identity(modules(), inputs.manifest, options.mode);
  const outputStamp = reserveOutput(options.output);
  let dir, fixtureStamp;
  const cleanup = () => {
    if (!dir) return;
    assert.deepEqual(stamp(options.output), outputStamp, '输出目录已变化，停止清理');
    assert.deepEqual(stamp(dir), fixtureStamp, '测试目录已变化，停止清理');
    fs.rmSync(dir, { recursive: true });
    dir = undefined;
  };
  try {
    dir = fixture(options.output);
    fixtureStamp = stamp(dir);
    const context = { binding: inputs.binding, identity: id, scripts: scriptIdentity(), dir, outputStamp, fixtureStamp };
    const normal = collect(cases, { ...context, phase: 'normal' }, args);
    const depth = options.mode === 'record-before' ? [] : collect(depthCases(), { ...context, phase: 'depth' }, args);
    const failures = failuresFor(normal, depth, inputs.baseline);
    assert.deepEqual(loadInputs(options).binding, inputs.binding, '结束输入绑定漂移');
    assert.deepEqual(scriptIdentity(), context.scripts, '结束脚本漂移');
    assert.deepEqual(identity(modules(), inputs.manifest, options.mode), id, '结束身份漂移');
    cleanup(); // 清理失败也不得先留下 passed 结果。
    const report = { time: new Date().toISOString(), status: failures.length ? 'failed' : 'passed', mode: options.mode,
      claim: options.mode === 'record-before' ? '仅旧包普通行为采集；不证明修补生效或安全验证通过' : '固定深度及兼容矩阵；不证明全部 DoS 消除或 audit 通过',
      timeoutMs: 5000, heapMiB: 128, scripts: context.scripts, binding: inputs.binding, identity: id, normal, depth, failures };
    save(options.output, outputStamp, options.mode === 'record-before' ? 'normal-before.json' : 'regression.json', report);
    console.log(JSON.stringify({ status: report.status, mode: options.mode, normal: normal.length, depth: depth.length,
      failures: failures.map(f => ({ id: f.case?.id || f.id, category: f.category })) }));
    return failures.length ? 1 : 0;
  } catch (e) {
    save(options.output, outputStamp, 'failure.json', { status: 'failed', mode: options.mode, error: e.message });
    throw e;
  } finally {
    cleanup();
  }
}

module.exports = { normalCases, modules, identity, normalize, failuresFor, main };
if (require.main === module) {
  try {
    if (process.argv[2] === '--child') child(process.argv.slice(3));
    else process.exitCode = main();
  } catch (e) {
    console.error(e.stack);
    process.exitCode = 1;
  }
}
