import { chmod } from 'fs/promises';
import { platform, arch } from 'os';
import { join } from 'path';

const PREBUILD_DIRS = {
  'darwin-arm64': 'darwin-arm64',
  'darwin-x64': 'darwin-x64',
};

async function run() {
  const key = `${platform()}-${arch()}`;
  const dir = PREBUILD_DIRS[key];

  if (dir) {
    const helper = join('node_modules', 'node-pty', 'prebuilds', dir, 'spawn-helper');
    try {
      await chmod(helper, 0o755);
      console.log(`node-pty: made ${helper} executable`);
    } catch (err) {
      console.warn(`node-pty: could not chmod ${helper} — ${err.message}`);
    }
  } else if (platform() === 'linux') {
    console.log('node-pty: compiled from source on Linux (no prebuilt needed)');
  }
}

run().catch(() => {});
