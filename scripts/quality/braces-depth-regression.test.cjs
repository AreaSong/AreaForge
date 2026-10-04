const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { spawnSync, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const io = require('./braces-depth-inputs.cjs');
const regression = require('./braces-depth-regression.cjs');
const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'areaforge-braces-organization-'));
after(() => fs.rmSync(dir, { recursive: true }));
const script = path.join(__dirname, 'braces-depth-regression.cjs');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (name, value) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  return file;
};
const sources = read(path.join(io.fixtureRoot, 'sources.json'));
const baseline = read(path.join(io.fixtureRoot, 'normal-before.json'));
const cases = JSON.parse(JSON.stringify(regression.normalCases()));
const loaded = regression.modules();
// DEP-2A 原始五后像，仅构造门禁测试输入；这不是新候选或安装批准。
const afterHashes = [
  'b651f7715e6db8942ce61d3394357b4d81c8ece88240aa31a458ea1165edd195',
  'f9fb688959232eee3e6ad7906a5b0e3234815db49ee857ef86983d65b917dc7c',
  '2974d5b8763a358d81dfa5b4b804329f525239f34429c396b93a540219504809',
  'ef9b3851f848460daaf91ff248222a43e266f97c4f2df7010cb7858e1e39a107',
  'b95a37edf8104a62276606213148cb06cec7cf5788c970ee7819e2f38012bc9b',
];
const beforeHashes = [
  'dc98f22eee3d511785d92a00758d5f0d48efed5f5813bdecc2de430c529b5c9f',
  'c18ac5adb57308f1ce42a28552da3a31f5d83709743ebd9a636336813a744d4b',
  '41ccc196ebfa7b7781a634e721eb744e4e7bcb54cba427a7e3d6806a1b9e58f7',
  'e572166565f15fa6ad9865ae49d678218e32aabfd1b3720f6d0d43d39800d310',
  '379f22d77bfa1478341ccd49c5e4267464aabcbba03558bab332aac23fc6f23a',
];
const manifest = { schema: 1, package: 'braces', version: '3.0.3',
  patchSha256: '97e90c15ea31c7bac144a42e20c8ce68e98a75d8042a3c6d9a8ce1b4f05d1141',
  files: ['lib/compile.js', 'lib/constants.js', 'lib/expand.js', 'lib/parse.js', 'lib/stringify.js']
    .map((file, i) => ({ file, beforeSha256: beforeHashes[i], afterSha256: afterHashes[i] })),
  unchangedFiles: ['index.js', 'lib/utils.js', 'package.json'].map(file => ({ file, sha256: io.sha(fs.readFileSync(path.join(loaded.bracesDir, file))) })),
  consumerChain: loaded.chain.map(({ name, sha256 }) => ({ name, sha256 })) };
const manifestPath = write('identity-test-manifest.json', manifest);
const hash = file => io.sha(fs.readFileSync(file));
const args = (output, mode = 'record-before') => ['--mode', mode, '--manifest', manifestPath,
  '--manifest-sha256', hash(manifestPath), '--output', path.join(dir, output)];
const run = argv => spawnSync(process.execPath, [script, ...argv], { encoding: 'utf8', timeout: 30000,
  env: { ...process.env, NODE_OPTIONS: '', NODE_DISABLE_COMPILE_CACHE: '1' } });

test('稳定 fixtures 的数量、摘要及完整比较用例保持一致', () => {
  for (const s of sources.sources) assert.equal(hash(path.join(io.fixtureRoot, s.fixture)), s.fixtureSha256);
  assert.equal(regression.normalCases().filter(c => c.kind === 'normal-braces').length, 17);
  assert.equal(cases.length, 58);
  io.validateBaseline(baseline, cases);
  assert.equal(baseline.normal[21].error.name, 'TypeError');
  assert.deepEqual(baseline.normal[29].result, ['apps/web', 'apps/web']);
  assert.equal(baseline.normal.filter(r => r.warnings.length).length, 2);
});

test('按原始 hash 核验 17 patterns / 58 组历史比较字段，无元数据混入',
  { skip: process.env.BRACES_VERIFY_SOURCES !== '1' }, () => {
    const originals = sources.sources.map(s => {
      const file = path.join(io.root, s.source);
      assert.equal(hash(file), s.sourceSha256);
      return read(file);
    });
    assert.deepEqual(read(path.join(io.fixtureRoot, 'patterns.json')), originals[0].map(r => r.pattern));
    assert.deepEqual(originals[1].failures, []);
    assert.deepEqual(baseline.normal, originals[1].normal.map(r => Object.fromEntries(
      io.comparisonKeys.filter(k => Object.hasOwn(r, k)).map(k => [k, r[k]]))));
  });

test('正常参数及不同合法基线位置（包括带空格的目录）', () => {
  const standard = io.parseArgs(args('standard', 'verify-patched'));
  io.validateBaseline(io.loadInputs(standard).baseline, cases);
  fs.mkdirSync(path.join(dir, 'baseline inputs'));
  const copy = write('baseline inputs/normal.json', baseline);
  for (const file of [copy, path.relative(process.cwd(), copy)]) {
    const custom = io.parseArgs([...args('custom', 'verify-patched'), '--baseline', file, '--baseline-sha256', hash(copy)]);
    assert.deepEqual(io.loadInputs(custom).baseline, baseline);
  }
});

test('缺参、未知参数、重复参数和旧旗标均失败关闭', () => {
  for (const key of ['--mode', '--manifest', '--manifest-sha256', '--output']) {
    const argv = args('missing'); const i = argv.indexOf(key); argv.splice(i, 2);
    assert.throws(() => io.parseArgs(argv), /缺少显式参数/);
  }
  for (const extra of [['--record-before'], ['--mode', 'record-before'], ['--unknown', 'x'], ['--patch']]) {
    assert.throws(() => io.parseArgs([...args('bad'), ...extra]));
  }
  assert.notEqual(run([]).status, 0);
});

test('清单严格拒绝空断言、错误包名、重复/穿越路径、假后像及消费链缺口', () => {
  for (const mutate of [m => { m.package = 'other'; }, m => { m.schema = 2; }, m => { m.files = []; },
    m => { m.files[0].file = '../parse.js'; }, m => { m.files[1] = m.files[0]; },
    m => { m.files[0].afterSha256 = m.files[0].beforeSha256; }, m => { m.files[0].afterSha256 = 'invalid'; },
    m => { m.unchangedFiles.pop(); }, m => { m.consumerChain = []; }, m => { m.extra = true; }]) {
    const copy = structuredClone(manifest); mutate(copy); assert.throws(() => io.validateManifest(copy));
  }
  assert.throws(() => io.validateManifest({ patchSha256: manifest.patchSha256, files: manifest.files }));
});

test('清单摘要、patch 摘要、JSON 格式和自定义基线摘要错误均拒绝', () => {
  const options = io.parseArgs(args('hashes', 'verify-patched'));
  assert.throws(() => io.loadInputs({ ...options, manifestHash: '0'.repeat(64) }), /摘要不符/);
  const altered = write('wrong-patch-manifest.json', { ...manifest, patchSha256: '0'.repeat(64) });
  assert.throws(() => io.loadInputs({ ...options, manifest: altered, manifestHash: hash(altered) }), /patch 摘要不符/);
  const malformed = path.join(dir, 'malformed.json'); fs.writeFileSync(malformed, '{', { flag: 'wx' });
  assert.throws(() => io.loadInputs({ ...options, manifest: malformed, manifestHash: hash(malformed) }), SyntaxError);
  assert.throws(() => io.loadInputs({ ...options, baselineHash: '0'.repeat(64) }), /摘要不符/);
});

test('普通基线必须完整、已通过、顺序一致且来自旧包模式', () => {
  for (const mutate of [b => { b.normal.pop(); }, b => { b.normal.reverse(); }, b => { b.failures.push({}); },
    b => { b.status = 'failed'; }, b => { b.mode = 'verify-patched'; }, b => { b.depth = [{}]; },
    b => { b.normal[0].category = 'RangeError'; }, b => { b.normal[0].signal = 'SIGKILL'; },
    b => { delete b.normal[0].result; }, b => { b.normal[0].warnings = null; }]) {
    const copy = structuredClone(baseline); mutate(copy); assert.throws(() => io.validateBaseline(copy, cases));
  }
});

test('旧包模式禁止基线参数；修补后模式自定义基线必须配对摘要', () => {
  assert.throws(() => io.parseArgs([...args('bad'), '--baseline', 'x', '--baseline-sha256', '0'.repeat(64)]), /不消费比较基线/);
  assert.throws(() => io.parseArgs([...args('bad', 'verify-patched'), '--baseline', 'x']), /同时提供/);
});

test('摘要正确的假值基线也必须在安装门禁之前失败关闭', () => {
  for (const [i, value] of [null, false, 0, ''].entries()) {
    const file = write(`false-baseline-${i}.json`, value);
    const result = run([...args(`false-baseline-output-${i}`, 'verify-patched'), '--baseline', file, '--baseline-sha256', hash(file)]);
    assert.equal(result.status, 1); assert.match(result.stderr, /validateBaseline/);
    assert.ok(!fs.existsSync(path.join(dir, `false-baseline-output-${i}`)));
  }
});

test('现有目录/结果/断链均拒绝，排他写保留已有文件字节', () => {
  const output = path.join(dir, 'exclusive'); const st = io.reserveOutput(output);
  io.save(output, st, 'regression.json', { original: true });
  const before = fs.readFileSync(path.join(output, 'regression.json'));
  assert.throws(() => io.reserveOutput(output), /已存在/);
  assert.throws(() => io.save(output, st, 'regression.json', { overwritten: true }), /EEXIST/);
  assert.deepEqual(fs.readFileSync(path.join(output, 'regression.json')), before);
  const existingFile = write('existing-file.json', { original: true });
  assert.throws(() => io.reserveOutput(existingFile), /已存在/);
  fs.symlinkSync('absent', path.join(dir, 'broken'));
  assert.throws(() => io.reserveOutput(path.join(dir, 'broken')), /EEXIST/);
});

test('拒绝源码、历史证据后代、祖先链接及被替换的输出目标', () => {
  for (const p of ['scripts/quality/braces-test-output', 'apps/braces-test-output', 'output/dependency-audit/braces-test-output']) {
    assert.throws(() => io.validateOutput(path.join(io.root, p)), /源码或历史证据/);
  }
  fs.symlinkSync(dir, path.join(dir, 'link'));
  assert.throws(() => io.reserveOutput(path.join(dir, 'link/new')), /祖先含链接/);
  const output = path.join(dir, 'replaced'); const st = io.reserveOutput(output);
  fs.renameSync(output, path.join(dir, 'retained'));
  fs.symlinkSync(path.join(dir, 'retained'), output);
  assert.throws(() => io.save(output, st, 'regression.json', { status: 'passed' }), /普通目录/);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'retained')), []);
});

test('路径归一化保留相对/绝对语义、尾斜杠、顺序与重复；比较不掩盖差异', () => {
  assert.deepEqual(regression.normalize([`${dir}/apps/web`, './apps/web', 'apps/web/', 'apps/web', 'apps/web'], dir),
    ['$FIX/apps/web', './apps/web', 'apps/web/', 'apps/web', 'apps/web']);
  for (const mutate of [r => { r.result = ['./apps/web']; }, r => { r.result.push('apps/web'); },
    r => { r.warnings.push('new warning'); }, r => { r.exitCode = 1; }]) {
    const rows = structuredClone(baseline.normal); mutate(rows[0]);
    assert.ok(io.compatibility(rows, baseline).length > 0);
  }
});

test('没有旧 output 也能读取正式测试输入；导入脚本无写入副作用', () => {
  const original = fs.readFileSync;
  fs.readFileSync = (file, ...rest) => {
    assert.ok(!String(file).includes(`${path.sep}output${path.sep}`), '不应读取历史 output');
    return original(file, ...rest);
  };
  try {
    assert.equal(regression.normalCases().length, 58);
    io.validateBaseline(io.loadInputs(io.parseArgs(args('independent', 'verify-patched'))).baseline, cases);
  } finally { fs.readFileSync = original; }
  assert.ok(!fs.existsSync(path.join(dir, 'independent')));
});

test('真实消费链原像可采集 58 组；没有深度测试且可作为显式已验证基线', () => {
  const result = run(args('collected'));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const reportPath = path.join(dir, 'collected/normal-before.json');
  const report = read(reportPath);
  assert.equal(report.status, 'passed'); assert.equal(report.mode, 'record-before'); assert.deepEqual(report.depth, []);
  assert.equal(report.normal.length, 58); assert.deepEqual(io.compatibility(report.normal, baseline), []);
  assert.ok(report.identity.files.filter(f => !f.file.endsWith('package.json')).every(f => f.loaded));
  const options = io.parseArgs([...args('reuse', 'verify-patched'), '--baseline', reportPath, '--baseline-sha256', hash(reportPath)]);
  io.validateBaseline(io.loadInputs(options).baseline, cases);
  const before = fs.readFileSync(reportPath);
  assert.notEqual(run(args('collected')).status, 0);
  assert.deepEqual(fs.readFileSync(reportPath), before);
});

test('当前真实原包必须拒绝修补后模式，不执行深度也不保存成功结论', () => {
  const result = run(args('rejected', 'verify-patched'));
  assert.equal(result.status, 1); assert.match(result.stderr, /安装后像不符/);
  assert.ok(!fs.existsSync(path.join(dir, 'rejected')));
  const altered = structuredClone(manifest); altered.consumerChain[0].sha256 = '0'.repeat(64);
  assert.throws(() => regression.identity(loaded, altered, 'record-before'), /真实消费链摘要不符/);
});

test('子进程不能通过旧 --child 接口绕过显式输入/身份门禁', () => {
  const result = run(['--child', JSON.stringify({ kind: 'depth', depth: 101 }), dir]);
  assert.equal(result.status, 1); assert.match(result.stderr, /未知或重复参数/);
});

test('分类失败及兼容失败必须进入 failures，不产生通过判定', () => {
  const rows = structuredClone(baseline.normal);
  rows[0].category = 'process-failure'; rows[0].exitCode = 1;
  const failures = regression.failuresFor(rows, [], baseline);
  assert.ok(failures.some(f => f.category === 'process-failure'));
  assert.ok(failures.some(f => f.category === 'compatibility'));
});

test('真实排他目录竞争只允许一个创建者', async () => {
  const output = path.join(dir, 'concurrent');
  const code = 'require(process.argv[1]).reserveOutput(process.argv[2])';
  const invoke = () => promisify(execFile)(process.execPath, ['-e', code, path.join(__dirname, 'braces-depth-inputs.cjs'), output]);
  const results = await Promise.allSettled([invoke(), invoke()]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  assert.deepEqual(fs.readdirSync(output), []);
});

test('采集中子进程失败会退出 1，并保存 failed 而非通过结论', () => {
  // 仅 mock 子进程失败，不替换安装树、身份门禁或任何深度算法。
  const code = `require('node:child_process').spawnSync = () => ({ status: 1, signal: null, stdout: '', stderr: 'synthetic child failure' });
    process.exitCode = require(process.argv[1]).main(process.argv.slice(2));`;
  const result = spawnSync(process.execPath, ['-e', code, script, ...args('failed-collection')], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  const report = read(path.join(dir, 'failed-collection/normal-before.json'));
  assert.equal(report.status, 'failed'); assert.equal(report.depth.length, 0); assert.ok(report.failures.length >= 58);
  assert.throws(() => io.validateBaseline(report, cases), /基线必须已通过/);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'failed-collection')), ['normal-before.json']);
});

test('子进程拒绝中途改变的输入或输出绑定，不能消费任意测试对象', () => {
  const argv = args('child-binding');
  const options = io.parseArgs(argv); const inputs = io.loadInputs(options);
  const result = spawnSync(process.execPath, [script, '--child', ...argv], {
    input: JSON.stringify({ binding: { ...inputs.binding, mode: 'verify-patched' } }), encoding: 'utf8',
  });
  assert.equal(result.status, 1); assert.match(result.stderr, /子进程输入绑定漂移/);
  assert.ok(!fs.existsSync(options.output));
});
