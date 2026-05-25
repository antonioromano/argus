import {
  FileCode,
  FileText,
  FileJson,
  Folder,
  FolderOpen,
  Image,
  Package,
  Globe,
  GitBranch,
  BookOpen,
  Archive,
  FileTerminal,
  FlaskConical,
  Container,
} from 'lucide-react';

interface FileTypeIconProps {
  ext: string;      // file extension including dot (e.g. '.tsx')
  name: string;     // full filename (for special cases like 'Dockerfile')
  isDir: boolean;
  isOpen?: boolean; // for folders — controls open/closed icon variant
}

const SIZE = 16;
const BASE_STYLE = { width: SIZE, height: SIZE, flexShrink: 0 as const };

// Special-case directory names mapped to a distinct icon + color pair.
const SPECIAL_DIR_ICONS: Record<string, { icon: React.ElementType; color: string }> = {
  '.git':        { icon: GitBranch, color: '#f97316' },
  'node_modules': { icon: Package,   color: '#6b7280' },
  'src':         { icon: Folder,    color: 'var(--color-accent, #4a90e2)' },
  'dist':        { icon: Package,   color: '#6b7280' },
  'build':       { icon: Package,   color: '#6b7280' },
  'out':         { icon: Package,   color: '#6b7280' },
  'public':      { icon: Globe,     color: '#06b6d4' },
  'static':      { icon: Globe,     color: '#06b6d4' },
  'test':        { icon: FlaskConical, color: '#a855f7' },
  'tests':       { icon: FlaskConical, color: '#a855f7' },
  'spec':        { icon: FlaskConical, color: '#a855f7' },
  '__tests__':   { icon: FlaskConical, color: '#a855f7' },
  'docs':        { icon: BookOpen,  color: '#6b7280' },
  'documentation': { icon: BookOpen, color: '#6b7280' },
};

// Extension → { icon component, color } lookup.
// Longest/most-specific matches are listed first within each group.
function getFileIconConfig(ext: string, name: string): { icon: React.ElementType; color: string } {
  // Special full-name matches (override extension logic)
  if (name === 'Dockerfile')               return { icon: Container, color: '#06b6d4' };
  if (name === 'docker-compose.yml')       return { icon: Container, color: '#06b6d4' };
  if (name === 'docker-compose.yaml')      return { icon: Container, color: '#06b6d4' };
  if (name === 'package.json')             return { icon: Package,   color: '#f59e0b' };
  if (name === 'package-lock.json')        return { icon: Package,   color: '#f59e0b' };

  switch (ext) {
    // TypeScript
    case '.ts':
    case '.tsx':
      return { icon: FileCode, color: '#3b82f6' };

    // JavaScript
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return { icon: FileCode, color: '#eab308' };

    // Styles
    case '.css':
    case '.scss':
    case '.sass':
    case '.less':
      return { icon: FileText, color: '#06b6d4' };

    // JSON
    case '.json':
    case '.jsonc':
      return { icon: FileJson, color: '#f59e0b' };

    // Markdown
    case '.md':
    case '.mdx':
      return { icon: FileText, color: '#6b7280' };

    // YAML
    case '.yaml':
    case '.yml':
      return { icon: FileText, color: '#a855f7' };

    // Python
    case '.py':
      return { icon: FileCode, color: '#3b82f6' };

    // Go
    case '.go':
      return { icon: FileCode, color: '#06b6d4' };

    // Rust
    case '.rs':
      return { icon: FileCode, color: '#f97316' };

    // Ruby
    case '.rb':
      return { icon: FileCode, color: '#ef4444' };

    // JVM
    case '.java':
    case '.kt':
      return { icon: FileCode, color: '#f97316' };

    // C / C++
    case '.c':
    case '.cpp':
    case '.h':
    case '.hpp':
      return { icon: FileCode, color: '#6366f1' };

    // Shell
    case '.sh':
    case '.bash':
    case '.zsh':
      return { icon: FileTerminal, color: '#10b981' };

    // HTML
    case '.html':
    case '.htm':
      return { icon: FileCode, color: '#f97316' };

    // Frontend frameworks
    case '.vue':
    case '.svelte':
      return { icon: FileCode, color: '#10b981' };

    // Images
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.gif':
    case '.webp':
    case '.svg':
    case '.ico':
    case '.bmp':
      return { icon: Image, color: '#6b7280' };

    // PDF
    case '.pdf':
      return { icon: FileText, color: '#ef4444' };

    // Archives
    case '.zip':
    case '.tar':
    case '.gz':
    case '.bz2':
    case '.7z':
      return { icon: Archive, color: '#6b7280' };

    // XML
    case '.xml':
      return { icon: FileCode, color: '#6b7280' };

    // TOML
    case '.toml':
      return { icon: FileText, color: '#6b7280' };

    // Env files
    case '.env':
      return { icon: FileText, color: '#10b981' };

    default:
      // Catch multi-dot env variants like '.env.local', '.env.production', etc.
      if (name.startsWith('.env')) return { icon: FileText, color: '#10b981' };
      return { icon: FileText, color: 'var(--color-text-muted)' };
  }
}

export function FileTypeIcon({ ext, name, isDir, isOpen = false }: FileTypeIconProps) {
  if (isDir) {
    const special = SPECIAL_DIR_ICONS[name];
    if (special) {
      const Icon = special.icon;
      return <Icon style={{ ...BASE_STYLE, color: special.color }} />;
    }
    // Default folder — open/closed variant
    const FolderIcon = isOpen ? FolderOpen : Folder;
    return <FolderIcon style={{ ...BASE_STYLE, color: 'var(--color-accent, #4a90e2)' }} />;
  }

  const { icon: Icon, color } = getFileIconConfig(ext, name);
  return <Icon style={{ ...BASE_STYLE, color }} />;
}
