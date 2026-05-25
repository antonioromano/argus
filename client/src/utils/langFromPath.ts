const EXT_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx',
  js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json',
  css: 'css', scss: 'scss', less: 'less',
  html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin', kts: 'kotlin',
  yaml: 'yaml', yml: 'yaml',
  toml: 'toml',
  md: 'markdown',
  mdx: 'jsx',
  sql: 'sql',
  graphql: 'graphql', gql: 'graphql',
  tf: 'hcl',
};

export function langFromPath(filePath: string): string | undefined {
  const lower = filePath.toLowerCase();
  const filename = lower.split('/').pop() ?? '';

  if (filename === 'dockerfile') return 'docker';
  if (filename === 'makefile') return 'makefile';

  const ext = filename.includes('.') ? filename.split('.').pop() : undefined;
  if (!ext) return undefined;

  // Skip .env files — avoid syntax emphasis on sensitive variable values
  if (ext === 'env' || filename.startsWith('.env')) return undefined;

  return EXT_MAP[ext];
}
