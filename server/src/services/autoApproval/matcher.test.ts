import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { AutoApprovalRule } from '@argus/shared';
import { allowHookOutput, globToRegExp, matchBashPrefix, matchRules, relativeInside, validateRuleInput } from './matcher.js';

let root: string;
let folder: string;
let outside: string;

before(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'argus-matcher-')));
  folder = path.join(root, 'proj');
  outside = path.join(root, 'secret');
  mkdirSync(path.join(folder, 'src'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(path.join(folder, 'src', 'a.ts'), '');
  writeFileSync(path.join(outside, 'id_rsa'), '');
  symlinkSync(outside, path.join(folder, 'link-out'));
  symlinkSync(path.join(outside, 'id_rsa'), path.join(folder, 'src', 'key.ts'));
  symlinkSync(path.join(folder, 'src'), path.join(folder, 'link-in'));
});

after(() => rmSync(root, { recursive: true, force: true }));

const rule = (r: Partial<AutoApprovalRule> & Pick<AutoApprovalRule, 'tool'>): AutoApprovalRule =>
  ({ id: `r-${r.tool}-${r.bashPrefix ?? r.pathGlob ?? ''}`, createdAt: 'x', ...r });

// --- Bash prefix ------------------------------------------------------------

test('Bash: exact command and word-boundary prefix match', () => {
  assert.equal(matchBashPrefix('git status', 'git status'), true);
  assert.equal(matchBashPrefix('git status', 'git status -s --porcelain'), true);
  assert.equal(matchBashPrefix('git status', 'git statusx'), false);
  assert.equal(matchBashPrefix('git status', 'git stat'), false);
  assert.equal(matchBashPrefix('npm test', 'npm test -- --watch'), true);
});

test('Bash: chaining, substitution, redirection and newline never match', () => {
  const bypasses = [
    'git status; rm -rf ~',
    'git status;rm -rf ~',
    'git status && rm -rf ~',
    'git status || rm -rf ~',
    'git status | sh',
    'git status & rm -rf ~',
    'git status `rm -rf ~`',
    'git status $(rm -rf ~)',
    'git status ${HOME}',
    'git status $HOME',
    'git status > ~/.zshenv',
    'git status >> ~/.zshenv',
    'git status < /etc/passwd',
    'git status\nrm -rf ~',
    'git status\rrm -rf ~',
    'git status \\\nrm -rf ~',
    'git status (rm)',
    'git status {a,b}',
    'git status\u0000rm',
    'git status rm -rf ~',
  ];
  for (const cmd of bypasses) {
    assert.equal(matchBashPrefix('git status', cmd), false, `must not match: ${JSON.stringify(cmd)}`);
  }
});

test('Bash: whitespace is normalized, case is not', () => {
  assert.equal(matchBashPrefix('git status', '   git    status   '), true);
  assert.equal(matchBashPrefix('git status', 'git\tstatus'), true);
  assert.equal(matchBashPrefix('git  status ', 'git status -s'), true);
  assert.equal(matchBashPrefix('git status', 'GIT status'), false);
  assert.equal(matchBashPrefix('git status', 'Git Status'), false);
  // A non-breaking space is not a separator to the shell either.
  assert.equal(matchBashPrefix('git status', 'git status'), false);
});

test('Bash: non-string, empty and oversized commands never match', () => {
  assert.equal(matchBashPrefix('git status', undefined), false);
  assert.equal(matchBashPrefix('git status', ['git', 'status']), false);
  assert.equal(matchBashPrefix('git status', ''), false);
  assert.equal(matchBashPrefix('git status', `git status ${'a'.repeat(5000)}`), false);
  assert.equal(matchBashPrefix('   ', 'anything'), false);
});

test('Bash: matchRules requires the exact tool name and refuses sandbox escapes', () => {
  const rules = [rule({ tool: 'Bash', bashPrefix: 'git status' })];
  assert.ok(matchRules(rules, folder, 'Bash', { command: 'git status' }));
  assert.equal(matchRules(rules, folder, 'bash', { command: 'git status' }), null);
  assert.equal(matchRules(rules, folder, 'BASH', { command: 'git status' }), null);
  assert.equal(matchRules(rules, folder, ' Bash', { command: 'git status' }), null);
  assert.equal(matchRules(rules, folder, 'Bash', { command: 'git status', dangerouslyDisableSandbox: true }), null);
  assert.equal(matchRules(rules, folder, 'Bash', null), null);
  assert.equal(matchRules(rules, folder, 'Bash', 'git status'), null);
  assert.equal(matchRules(rules, folder, '__proto__', { command: 'git status' }), null);
  assert.equal(matchRules(rules, folder, 'mcp__x__Bash', { command: 'git status' }), null);
});

// --- File paths -------------------------------------------------------------

test('file: inside the folder matches, the folder itself does not', () => {
  assert.equal(relativeInside(folder, path.join(folder, 'src', 'a.ts')), 'src/a.ts');
  assert.equal(relativeInside(folder, path.join(folder, 'src', 'new-file.ts')), 'src/new-file.ts');
  assert.equal(relativeInside(folder, folder), null);
  assert.equal(relativeInside(folder, 'src/a.ts'), null, 'relative paths are refused');
});

test('file: ../ escapes are refused', () => {
  assert.equal(relativeInside(folder, path.join(folder, '..', 'secret', 'id_rsa')), null);
  assert.equal(relativeInside(folder, `${folder}/src/../../secret/id_rsa`), null);
  assert.equal(relativeInside(folder, `${folder}-evil/x.ts`), null, 'sibling with a shared prefix');
  const rules = [rule({ tool: 'Read', pathGlob: '**' })];
  assert.equal(matchRules(rules, folder, 'Read', { file_path: `${folder}/../secret/id_rsa` }), null);
});

test('file: symlinks out of the folder are refused, symlinks within it resolve', () => {
  assert.equal(relativeInside(folder, path.join(folder, 'link-out', 'id_rsa')), null);
  assert.equal(relativeInside(folder, path.join(folder, 'link-out', 'new.txt')), null, 'new file under an escaping dir');
  assert.equal(relativeInside(folder, path.join(folder, 'src', 'key.ts')), null, 'file symlink pointing out');
  assert.equal(relativeInside(folder, path.join(folder, 'link-in', 'a.ts')), 'src/a.ts');
  const rules = [rule({ tool: 'Read', pathGlob: 'src/**' })];
  assert.equal(matchRules(rules, folder, 'Read', { file_path: path.join(folder, 'src', 'key.ts') }), null);
});

test('file: control characters in the path are refused', () => {
  assert.equal(relativeInside(folder, `${folder}/src/a\n.ts`), null);
  assert.equal(relativeInside(folder, `${folder}/src/a\u0000.ts`), null);
});

test('file: glob semantics', () => {
  assert.equal(globToRegExp('**').test('src/a.ts'), true);
  assert.equal(globToRegExp('src/**').test('src/a/b/c.ts'), true);
  assert.equal(globToRegExp('src/*.ts').test('src/a.ts'), true);
  assert.equal(globToRegExp('src/*.ts').test('src/a/b.ts'), false);
  assert.equal(globToRegExp('**/*.md').test('README.md'), true);
  assert.equal(globToRegExp('**/*.md').test('docs/x/README.md'), true);
  assert.equal(globToRegExp('a?.ts').test('ab.ts'), true);
  assert.equal(globToRegExp('a?.ts').test('a/.ts'), false);
  assert.equal(globToRegExp('src/a.ts').test('src/aXts'), false, '. is literal');
  assert.equal(globToRegExp('src/**').test('SRC/a.ts'), false, 'case-sensitive');
});

test('file: matchRules uses file_path, NotebookEdit uses notebook_path', () => {
  const rules = [rule({ tool: 'Edit', pathGlob: 'src/**' }), rule({ tool: 'NotebookEdit', pathGlob: '**' })];
  assert.equal(matchRules(rules, folder, 'Edit', { file_path: path.join(folder, 'src', 'a.ts') })?.summary, 'src/a.ts');
  assert.equal(matchRules(rules, folder, 'Edit', { file_path: path.join(folder, 'README.md') }), null);
  assert.equal(matchRules(rules, folder, 'Write', { file_path: path.join(folder, 'src', 'a.ts') }), null, 'rule is per tool');
  assert.ok(matchRules(rules, folder, 'NotebookEdit', { notebook_path: path.join(folder, 'n.ipynb') }));
  assert.equal(matchRules(rules, folder, 'NotebookEdit', { file_path: path.join(folder, 'n.ipynb') }), null);
});

test('file: writes never auto-approve .git, .claude, .mcp.json (any case)', () => {
  const rules = [rule({ tool: 'Write', pathGlob: '**' }), rule({ tool: 'Edit', pathGlob: '**' }), rule({ tool: 'Read', pathGlob: '**' })];
  for (const p of ['.git/config', '.git/hooks/pre-commit', '.claude/settings.local.json', '.CLAUDE/settings.json', '.Git/config', '.mcp.json', 'sub/.claude/x', '.envrc']) {
    assert.equal(matchRules(rules, folder, 'Write', { file_path: path.join(folder, p) }), null, p);
    assert.equal(matchRules(rules, folder, 'Edit', { file_path: path.join(folder, p) }), null, p);
  }
  assert.ok(matchRules(rules, folder, 'Read', { file_path: path.join(folder, '.git', 'config') }), 'reads are not protected');
});

// --- Rule validation --------------------------------------------------------

test('validateRuleInput: Bash needs a clean prefix', () => {
  assert.deepEqual(validateRuleInput({ tool: 'Bash', bashPrefix: '  git   status ' }), { ok: true, tool: 'Bash', bashPrefix: 'git status' });
  assert.equal(validateRuleInput({ tool: 'Bash' }).ok, false);
  assert.equal(validateRuleInput({ tool: 'Bash', bashPrefix: '   ' }).ok, false);
  assert.equal(validateRuleInput({ tool: 'Bash', bashPrefix: 'git status; rm' }).ok, false);
  assert.equal(validateRuleInput({ tool: 'Bash', bashPrefix: 'echo $(id)' }).ok, false);
  assert.equal(validateRuleInput({ tool: 'Bash', bashPrefix: 'git', pathGlob: '**' }).ok, false);
  assert.equal(validateRuleInput({ tool: 'bash', bashPrefix: 'git' }).ok, false);
  assert.equal(validateRuleInput({ tool: 'WebFetch' }).ok, false);
});

test('validateRuleInput: file globs stay relative to the folder', () => {
  assert.deepEqual(validateRuleInput({ tool: 'Read' }), { ok: true, tool: 'Read', pathGlob: '**' });
  assert.deepEqual(validateRuleInput({ tool: 'Edit', pathGlob: 'src/**' }), { ok: true, tool: 'Edit', pathGlob: 'src/**' });
  for (const bad of ['/etc/**', '../**', 'src/../../x', './src', '~/x', 'src/[ab]', 'src/{a,b}', 'a\\b']) {
    assert.equal(validateRuleInput({ tool: 'Edit', pathGlob: bad }).ok, false, bad);
  }
  assert.equal(validateRuleInput({ tool: 'Read', bashPrefix: 'x' }).ok, false);
});

// --- Output shape -----------------------------------------------------------

test('allowHookOutput is the documented PreToolUse decision shape', () => {
  assert.deepEqual(allowHookOutput('abc'), {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'Auto-approved by Argus rule abc',
    },
  });
});

// --- Security review regressions --------------------------------------------

test('review: prefix matches only on token boundaries', () => {
  assert.equal(matchBashPrefix('git status', 'git statusX'), false);
  assert.equal(matchBashPrefix('git status', 'git status-foo'), false);
  assert.equal(matchBashPrefix('git status', 'git status.sh'), false);
  assert.equal(matchBashPrefix('git status', 'git status'), true);
  assert.equal(matchBashPrefix('git status', 'git status --short'), true);
});

test('review: every chaining, redirection and substitution form falls through', () => {
  const forms = [
    'npm test; id', 'npm test && id', 'npm test || id', 'npm test | id', 'npm test & id', 'npm test &',
    'npm test > out', 'npm test >> out', 'npm test < in', 'npm test 2>&1',
    'npm test `id`', 'npm test $(id)', 'npm test ${IFS}id', 'npm test <(id)', 'npm test >(id)',
    'npm test\nid', 'npm test\rid', 'npm test\u0000id',
    // escaped or quoted variants
    'npm test \; id', 'npm test ";" id', "npm test ';' id", 'npm test "&&" id', "npm test '|' id",
    'npm test "$(id)"', "npm test '`id`'", 'npm test \\\nid', 'npm test "\n" id',
  ];
  for (const cmd of forms) assert.equal(matchBashPrefix('npm test', cmd), false, JSON.stringify(cmd));
});

test('review: env assignments and wrappers as the first token fall through', () => {
  const forms = [
    'FOO=bar npm test', 'NODE_OPTIONS=--require=x npm test',
    'env npm test', '/usr/bin/env npm test', 'sudo npm test', 'xargs npm test', 'sh -c npm test',
    'bash -c npm test', 'eval npm test', 'exec npm test', 'command npm test', 'nohup npm test',
    'time npm test', '"sudo" npm test', "'env' npm test",
  ];
  for (const cmd of forms) {
    assert.equal(matchBashPrefix('npm test', cmd), false, cmd);
  }
  // Even a rule that names the wrapper itself never matches.
  for (const [prefix, cmd] of [['sudo', 'sudo ls'], ['env', 'env'], ['FOO=1 npm', 'FOO=1 npm test'], ['bash -c', 'bash -c ls']] as const) {
    assert.equal(matchBashPrefix(prefix, cmd), false, prefix);
    assert.equal(validateRuleInput({ tool: 'Bash', bashPrefix: prefix }).ok, false, `rule ${prefix}`);
  }
  // A wrapper word later in the command is just an argument.
  assert.equal(matchBashPrefix('git log', 'git log --grep sudo'), true);
});

test('review: tool names match exactly and case-sensitively', () => {
  const rules = [rule({ tool: 'Read', pathGlob: '**' })];
  const input = { file_path: path.join(folder, 'src', 'a.ts') };
  assert.ok(matchRules(rules, folder, 'Read', input));
  for (const name of ['read', 'READ', 'Read ', 'Rea', 'ReadFile', 'Edit']) {
    assert.equal(matchRules(rules, folder, name, input), null, name);
  }
});

test('review: separator-aware containment (/a/foo never contains /a/foobar)', () => {
  mkdirSync(`${folder}bar`, { recursive: true });
  writeFileSync(path.join(`${folder}bar`, 'x.ts'), '');
  assert.equal(relativeInside(folder, path.join(`${folder}bar`, 'x.ts')), null);
  const rules = [rule({ tool: 'Read', pathGlob: '**' })];
  assert.equal(matchRules(rules, folder, 'Read', { file_path: path.join(`${folder}bar`, 'x.ts') }), null);
});

test('review: new files resolve through the deepest existing ancestor; leftover .. is refused', () => {
  // New file under a real dir: allowed.
  assert.equal(relativeInside(folder, path.join(folder, 'src', 'deep', 'new', 'f.ts')), 'src/deep/new/f.ts');
  // New file under a symlinked dir pointing out: refused.
  assert.equal(relativeInside(folder, path.join(folder, 'link-out', 'deep', 'new.ts')), null);
  // `..` anywhere in the raw path is refused, even when it would land inside.
  assert.equal(relativeInside(folder, `${folder}/src/../src/a.ts`), null);
  assert.equal(relativeInside(folder, `${folder}/src/./a.ts`), null);
  assert.equal(relativeInside(folder, `${folder}/missing/../../secret/id_rsa`), null);
  const rules = [rule({ tool: 'Write', pathGlob: '**' })];
  assert.equal(matchRules(rules, folder, 'Write', { file_path: path.join(folder, 'link-out', 'evil.sh') }), null);
});

test('review: unicode is NFC-normalized and NUL is refused', () => {
  const nfc = 'café.ts';
  const nfd = 'café.ts';
  assert.equal(relativeInside(folder, path.join(folder, 'src', nfd)), `src/${nfc}`);
  assert.equal(globToRegExp(`src/${nfc}`).test(relativeInside(folder, path.join(folder, 'src', nfd))!), true);
  assert.equal(relativeInside(folder, `${folder}/src/a.ts\u0000/../../secret/id_rsa`), null);
  assert.equal(relativeInside(folder, `${folder}/src/a\u0000`), null);
});
