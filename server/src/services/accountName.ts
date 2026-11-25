import { execFile } from 'child_process';
import os from 'os';

let cached: Promise<string> | null = null;

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 2000 }, (err, stdout) => resolve(err ? '' : String(stdout ?? '').trim()));
  });
}

/**
 * A human name to prefill a first profile: the macOS account's full name
 * (`id -F`) when it is a real name, else the global git `user.name`, else the
 * short user name. Many Macs are set up with the full name equal to the account
 * name ("Macbookpro10"), which is why git is consulted. The user can rename it.
 */
export function accountName(): Promise<string> {
  cached ??= (async () => {
    const user = os.userInfo().username;
    const full = process.platform === 'darwin' ? await run('id', ['-F']) : '';
    if (full && full.toLowerCase() !== user.toLowerCase()) return full;
    const git = await run('git', ['config', '--global', 'user.name']);
    return git || full || user;
  })();
  return cached;
}
