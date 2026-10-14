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
