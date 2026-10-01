import path from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

/**
 * zsh shell integration for plain Shell sessions (no AI), the VS Code / iTerm
 * approach: Argus points ZDOTDIR at a directory of its own whose startup files
 * source the user's real ones FIRST — oh-my-zsh, aliases, prompt all load as
 * usual — and only then fill gaps:
 *   - a completion menu (arrow keys, case-insensitive) if the user has none,
 *   - inline history/completion suggestions (bundled zsh-autosuggestions),
 *   - OSC 7 cwd reports on every prompt, so Argus can follow `cd` and show the
 *     git context of wherever the shell actually is.
 *
 * Persistent sessions start as `$SHELL -l -c "exec <shell>"`, so the OUTER login
 * shell reads .zshenv/.zprofile/.zlogin from this directory too — each forwards
 * to the user's file, otherwise e.g. Homebrew's PATH (set in .zprofile) is lost.
 */

/** Forwards one startup file to the user's own copy, then hands ZDOTDIR back to Argus. */
function forward(file: string): string {
  return `# Argus shell integration — forwards to your own ${file}.
__argus_zdotdir=$ZDOTDIR
ZDOTDIR=\${ARGUS_USER_ZDOTDIR:-$HOME}
[[ -r $ZDOTDIR/${file} ]] && source $ZDOTDIR/${file}
ZDOTDIR=$__argus_zdotdir
unset __argus_zdotdir
`;
}

export const ZSHENV = `# Argus shell integration — forwards to your own .zshenv.
__argus_zdotdir=$ZDOTDIR
ZDOTDIR=\${ARGUS_USER_ZDOTDIR:-$HOME}
[[ -r $ZDOTDIR/.zshenv ]] && source $ZDOTDIR/.zshenv
# Your .zshenv may move ZDOTDIR (e.g. ~/.config/zsh): follow it for the other files.
export ARGUS_USER_ZDOTDIR=$ZDOTDIR
ZDOTDIR=$__argus_zdotdir
unset __argus_zdotdir
`;

export const ZSHRC = `# Argus shell integration — loads your own .zshrc, then fills the gaps.
__argus_zdotdir=$ZDOTDIR
ZDOTDIR=\${ARGUS_USER_ZDOTDIR:-$HOME}
# macOS /etc/zshrc derived HISTFILE from Argus's ZDOTDIR; point it back at yours
# before your .zshrc runs (it may still set its own).
[[ $HISTFILE == $__argus_zdotdir/* ]] && HISTFILE=$ZDOTDIR/.zsh_history
[[ -r $ZDOTDIR/.zshrc ]] && source $ZDOTDIR/.zshrc
# From here on ZDOTDIR stays yours (compinit dumps, .zlogin, subshells).
unset __argus_zdotdir
[[ -r $ARGUS_SHELL_INTEGRATION_DIR/integration.zsh ]] && source $ARGUS_SHELL_INTEGRATION_DIR/integration.zsh
`;

export const INTEGRATION = `# Argus shell integration: only adds what your config doesn't already set.

# Completion menu — Tab after \`cd sr\` lists matching folders, arrows to pick.
if (( ! $+functions[compdef] )); then
  __argus_cache=\${XDG_CACHE_HOME:-$HOME/.cache}/argus
  [[ -d $__argus_cache ]] || mkdir -p $__argus_cache
  autoload -Uz compinit && compinit -i -d $__argus_cache/zcompdump-$ZSH_VERSION
  unset __argus_cache
fi
zmodload -i zsh/complist 2>/dev/null
zstyle -m ':completion:argus' menu '*' || zstyle ':completion:*' menu select
zstyle -m ':completion:argus' matcher-list '*' || \\
  zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z}' 'r:|[._-]=* r:|=*' 'l:|=* r:|=*'
zstyle -m ':completion:argus' list-colors '*' || zstyle ':completion:*' list-colors ''

# Inline suggestions while typing (accept with →): history first, then completion,
# so \`cd sr\` already proposes \`cd src/\`. Skipped if you load the plugin yourself.
if (( ! $+functions[_zsh_autosuggest_start] )) && [[ -r $ARGUS_ZSH_AUTOSUGGEST ]]; then
  (( $+ZSH_AUTOSUGGEST_STRATEGY )) || ZSH_AUTOSUGGEST_STRATEGY=(history completion)
  source $ARGUS_ZSH_AUTOSUGGEST
fi

# Report the cwd to Argus (OSC 7) on every prompt and cd — drives the git context
# shown in the tile header. Under tmux it must be wrapped in a DCS passthrough.
__argus_report_cwd() {
  local p=\${PWD//\\%/%25}
  p=\${p// /%20}
  if [[ -n $TMUX ]]; then
    printf '\\ePtmux;\\e\\e]7;file://%s%s\\a\\e\\\\' "$HOST" "$p"
  else
    printf '\\e]7;file://%s%s\\a' "$HOST" "$p"
  fi
}
autoload -Uz add-zsh-hook
add-zsh-hook precmd __argus_report_cwd
add-zsh-hook chpwd __argus_report_cwd
`;

/**
 * Bundled zsh-autosuggestions (MIT, v0.7.1), resolved like resolveSignalBin:
 * packaged .app → resourcesPath/shell-integration, dev → repo resources/.
 */
export function resolveAutosuggest(): string {
  const file = 'zsh-autosuggestions.zsh';
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    const bundled = path.join(resourcesPath, 'shell-integration', file);
    if (existsSync(bundled)) return bundled;
  }
  // This file lives at server/{src,dist}/services/, three levels under the repo root.
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../resources/shell-integration', file);
}

/**
 * Write the integration files under `dataDir` and return the env that activates
 * them, or null when the user's shell isn't zsh (bash/fish get the plain shell).
 * Rewritten on every spawn: a few hundred bytes, and an app update ships new
 * content without any migration.
 */
export function zshIntegrationEnv(
  dataDir: string,
  shellPath: string = process.env.SHELL || '/bin/zsh',
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> | null {
  if (path.basename(shellPath) !== 'zsh') return null;
  const dir = path.join(dataDir, 'shell-integration', 'zsh');
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, '.zshenv'), ZSHENV);
    writeFileSync(path.join(dir, '.zprofile'), forward('.zprofile'));
    writeFileSync(path.join(dir, '.zshrc'), ZSHRC);
    writeFileSync(path.join(dir, '.zlogin'), forward('.zlogin'));
    writeFileSync(path.join(dir, 'integration.zsh'), INTEGRATION);
  } catch (e) {
    console.warn('[shellIntegration] could not write zsh integration, starting a plain shell:', e);
    return null;
  }
  return {
    ZDOTDIR: dir,
    ARGUS_USER_ZDOTDIR: env.ZDOTDIR || env.HOME || '',
    ARGUS_SHELL_INTEGRATION_DIR: dir,
    ARGUS_ZSH_AUTOSUGGEST: resolveAutosuggest(),
  };
}
