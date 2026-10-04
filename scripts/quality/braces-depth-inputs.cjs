// 回归输入与排他输出契约；不安装、应用或推断任何候选补丁。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(__dirname, 'fixtures/braces');
const sha = data => createHash('sha256').update(data).digest('hex');
const comparisonKeys = ['case', 'category', 'result', 'error', 'warnings', 'exitCode', 'signal'];
const changedFiles = ['lib/compile.js', 'lib/constants.js', 'lib/expand.js', 'lib/parse.js', 'lib/stringify.js'];
const unchangedFiles = ['index.js', 'lib/utils.js', 'package.json'];
const consumerNames = ['eslint-config-next', '@next/eslint-plugin-next', 'fast-glob', 'micromatch', 'braces'];

function digest(value) {
  assert.match(value, /^[a-f0-9]{64}$/, '必须是小写 SHA-256');
  return value;
}

function keys(value, required, optional = []) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), '须为对象');
  assert.ok(required.every(k => Object.hasOwn(value, k)), '缺少必需字段');
  assert.ok(Object.keys(value).every(k => [...required, ...optional].includes(k)), '未知字段');
}

function parseArgs(args) {
  const values = {};
  const names = ['--mode', '--manifest', '--manifest-sha256', '--patch', '--baseline', '--baseline-sha256', '--output'];
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    assert.ok(names.includes(key) && !Object.hasOwn(values, key), `未知或重复参数 ${key}`);
    assert.ok(args[i + 1] && !args[i + 1].startsWith('--'), `缺少参数值 ${key}`);
    values[key] = args[i + 1];
  }
  for (const key of ['--mode', '--manifest', '--manifest-sha256', '--output']) assert.ok(values[key], `缺少显式参数 ${key}`);
  assert.ok(['record-before', 'verify-patched'].includes(values['--mode']), '未知运行模式');
  assert.equal(Boolean(values['--baseline']), Boolean(values['--baseline-sha256']), '自定义基线须同时提供路径和 SHA-256');
  const before = values['--mode'] === 'record-before';
  assert.ok(!before || !values['--baseline'], '旧包采集模式不消费比较基线');
  return { mode: values['--mode'], manifest: path.resolve(values['--manifest']),
    manifestHash: digest(values['--manifest-sha256']), patch: path.resolve(values['--patch'] || path.join(root, 'patches/braces@3.0.3.patch')),
    baseline: before ? null : path.resolve(values['--baseline'] || path.join(fixtureRoot, 'normal-before.json')),
    baselineHash: values['--baseline-sha256'] ? digest(values['--baseline-sha256']) : null,
    output: path.resolve(values['--output']) };
}

function readBound(file, expected) {
  const bytes = fs.readFileSync(file);
  const hash = sha(bytes);
  assert.equal(hash, digest(expected), `摘要不符: ${file}`);
  return { path: file, sha256: hash, value: JSON.parse(bytes) };
}

function validateManifest(m) {
  keys(m, ['schema', 'package', 'version', 'patchSha256', 'files', 'unchangedFiles', 'consumerChain'],
    ['integrity', 'sourceTarball', 'sourceTarballSha256', 'observationsSha256']);
  assert.equal(m.schema, 1); assert.equal(m.package, 'braces'); assert.equal(m.version, '3.0.3');
  digest(m.patchSha256);
  for (const k of ['sourceTarballSha256', 'observationsSha256']) if (Object.hasOwn(m, k)) digest(m[k]);
  for (const k of ['sourceTarball', 'integrity']) if (Object.hasOwn(m, k)) assert.ok(typeof m[k] === 'string' && m[k].length > 0);
  assert.ok(Array.isArray(m.files)); assert.deepEqual(m.files.map(f => f.file), changedFiles, '须按顺序绑定完整五文件');
  for (const f of m.files) {
    keys(f, ['file', 'beforeSha256', 'afterSha256']); digest(f.beforeSha256); digest(f.afterSha256);
    assert.notEqual(f.beforeSha256, f.afterSha256, '候选后像不能冒充原像');
  }
  for (const [rows, names, key] of [[m.unchangedFiles, unchangedFiles, 'file'], [m.consumerChain, consumerNames, 'name']]) {
    assert.ok(Array.isArray(rows)); assert.deepEqual(rows.map(f => f[key]), names, '身份断言集合不完整');
    rows.forEach(f => { keys(f, [key, 'sha256']); digest(f.sha256); });
  }
  assert.equal(m.consumerChain.at(-1).sha256, m.unchangedFiles[0].sha256, 'braces 入口摘要矛盾');
  return m;
}

function validateBaseline(baseline, cases) {
  assert.ok(baseline && typeof baseline === 'object');
  assert.deepEqual(baseline.failures, [], '基线必须已通过');
  if (Object.hasOwn(baseline, 'status')) assert.equal(baseline.status, 'passed', '失败记录不能用作基线');
  if (Object.hasOwn(baseline, 'mode')) assert.equal(baseline.mode, 'record-before', '只能消费旧包基线');
  if (Object.hasOwn(baseline, 'depth')) assert.deepEqual(baseline.depth, [], '基线不能混入修补后深度结果');
  assert.ok(Array.isArray(baseline.normal)); assert.equal(baseline.normal.length, cases.length, '基线数量不完整');
  baseline.normal.forEach((r, i) => {
    assert.equal(JSON.stringify(r.case), JSON.stringify(cases[i]), `基线用例不符: ${i}`);
    assert.equal(r.category, cases[i].expected, `基线分类不符: ${i}`);
    assert.equal(r.exitCode, 0); assert.equal(r.signal, null);
    assert.ok(Array.isArray(r.warnings) && r.warnings.every(v => typeof v === 'string'));
    if (r.category === 'ok') { assert.ok(Object.hasOwn(r, 'result')); assert.ok(!Object.hasOwn(r, 'error')); }
    else { keys(r.error, ['name', 'message']); assert.equal(r.error.name, r.category); assert.equal(typeof r.error.message, 'string'); }
  });
  return baseline;
}

function loadInputs(options) {
  const sources = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'sources.json'), 'utf8'));
  const patterns = readBound(path.join(fixtureRoot, 'patterns.json'), sources.sources[0].fixtureSha256);
  assert.ok(Array.isArray(patterns.value) && patterns.value.length === 17 && patterns.value.every(p => typeof p === 'string'));
  const manifest = readBound(options.manifest, options.manifestHash);
  validateManifest(manifest.value);
  const patchHash = sha(fs.readFileSync(options.patch));
  assert.equal(patchHash, manifest.value.patchSha256, '候选 patch 摘要不符（未应用）');
  const baseline = options.baseline ? readBound(options.baseline, options.baselineHash || sources.sources[1].fixtureSha256) : null;
  return { manifest: manifest.value, patterns: patterns.value, baseline: baseline?.value,
    binding: { mode: options.mode, output: options.output, manifest: { path: manifest.path, sha256: manifest.sha256 },
      patch: { path: options.patch, sha256: patchHash }, patterns: { path: patterns.path, sha256: patterns.sha256 },
      baseline: baseline ? { path: baseline.path, sha256: baseline.sha256 } : null } };
}

function within(file, parent) {
  const relative = path.relative(parent, file);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function validateOutput(output) {
  const parent = path.dirname(output);
  assert.equal(fs.realpathSync(parent), parent, '输出祖先含链接；须使用真实路径');
  assert.ok(!fs.existsSync(output), '输出目标已存在，拒绝复用');
  // 仓库内只允许 output 的全新直接子目录，历史证据树及全部源码树均不接收输出。
  assert.ok(!within(output, root) || parent === path.join(root, 'output'), '拒绝源码或历史证据目录');
  assert.ok(!within(root, output), '拒绝仓库祖先目录');
  return output;
}

function stamp(dir) {
  const s = fs.lstatSync(dir);
  assert.ok(s.isDirectory() && !s.isSymbolicLink(), '输出必须是普通目录');
  assert.equal(fs.realpathSync(dir), dir, '输出链接目标不安全');
  return { dev: s.dev, ino: s.ino };
}

function reserveOutput(output) {
  validateOutput(output);
  fs.mkdirSync(output, { mode: 0o700 }); // mkdir 的 EEXIST 是并发运行的排他门禁。
  return stamp(output);
}

function save(output, expectedStamp, name, value) {
  assert.deepEqual(stamp(output), expectedStamp, '输出目录身份已变化');
  fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}

function compatibility(normal, baseline) {
  const failures = [];
  normal.forEach((r, i) => {
    for (const key of comparisonKeys) if (JSON.stringify(r[key]) !== JSON.stringify(baseline.normal[i][key])) {
      failures.push({ id: r.case.id, category: 'compatibility', key });
    }
  });
  return failures;
}

module.exports = { root, fixtureRoot, sha, comparisonKeys, consumerNames, parseArgs, validateManifest,
  validateBaseline, loadInputs, validateOutput, reserveOutput, stamp, save, compatibility };
