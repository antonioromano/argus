export function registerProcessHandlers(): void {
  process.on('unhandledRejection', (reason) => {
    console.error('[process] unhandledRejection:', reason);
    // Don't exit — tmux keeps sessions alive; crashing the server would orphan all sessions.
  });

  process.on('uncaughtException', (err) => {
    console.error('[process] uncaughtException:', err);
    process.exit(1);
  });
}
