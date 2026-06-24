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

const MONACO_LANG_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
  sh: 'shell', bash: 'shell', zsh: 'shell',
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
  toml: 'ini',
  md: 'markdown',
  mdx: 'markdown',
  sql: 'sql',
  graphql: 'graphql', gql: 'graphql',
  tf: 'hcl',
};

export function monacoLanguageFor(filePath: string): string {
  const lower = filePath.toLowerCase();
  const filename = lower.split('/').pop() ?? '';
  if (filename === 'dockerfile') return 'dockerfile';
  const ext = filename.includes('.') ? filename.split('.').pop() : undefined;
  if (!ext) return 'plaintext';
  return MONACO_LANG_MAP[ext] ?? 'plaintext';
}

export function isMarkdownPath(filePath: string): boolean {
  const ext = filePath.toLowerCase().split('.').pop();
  return ext === 'md' || ext === 'mdx' || ext === 'markdown';
}

export type PreviewKind = 'markdown' | 'csv';

/** Which rendered-preview pane (if any) a file gets alongside the editor. */
export function previewKind(filePath: string): PreviewKind | null {
  const ext = filePath.toLowerCase().split('.').pop();
  if (ext === 'md' || ext === 'mdx' || ext === 'markdown') return 'markdown';
  if (ext === 'csv') return 'csv';
  return null;
}
