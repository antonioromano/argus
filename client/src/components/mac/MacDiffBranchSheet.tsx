import { useState } from 'react';
import { MacSheet } from './MacSheet.js';
import { MacInput, MacSelect } from './primitives/index.js';

interface MacDiffBranchSheetProps {
  isOpen: boolean;
  onClose: () => void;
  branches: string[];
  currentBranch: string;
  onCreateBranch: (name: string) => Promise<void>;
  onPullAndBranch: (name: string, baseBranch: string) => Promise<void>;
  branchLoading: boolean;
  branchError: string;
}

export function MacDiffBranchSheet({
  isOpen,
  onClose,
  branches,
  currentBranch,
  onCreateBranch,
  onPullAndBranch,
  branchLoading,
  branchError,
}: MacDiffBranchSheetProps) {
  const [newBranchName, setNewBranchName] = useState('');
  const [pullBranchName, setPullBranchName] = useState('');
  const [pullBaseBranch, setPullBaseBranch] = useState(
    branches.find(b => b === 'main' || b === 'master') || currentBranch
  );
  const [localError, setLocalError] = useState('');

  const branchOptions = branches.map(b => ({ value: b, label: b }));

  const handleCreate = async () => {
    const name = newBranchName.trim();
    if (!name) return;
    if (/\s/.test(name)) { setLocalError('Branch name cannot contain spaces'); return; }
    setLocalError('');
    try {
      await onCreateBranch(name);
      setNewBranchName('');
      onClose();
    } catch {
      setLocalError('Create branch failed');
    }
  };

  const handlePullAndBranch = async () => {
    const name = pullBranchName.trim();
    if (!name) return;
    if (/\s/.test(name)) { setLocalError('Branch name cannot contain spaces'); return; }
    setLocalError('');
    try {
      await onPullAndBranch(name, pullBaseBranch);
      setPullBranchName('');
      onClose();
    } catch {
      setLocalError('Pull and branch failed');
    }
  };

  const error = localError || branchError;

  return (
    <MacSheet isOpen={isOpen} title="Branch" onClose={onClose} width={380}>
      {/* Create branch section */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          New Branch
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <MacInput
              value={newBranchName}
              onChange={setNewBranchName}
              placeholder="branch-name"
              mono
              disabled={branchLoading}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreate(); } }}
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={branchLoading || !newBranchName.trim()}
            style={primaryBtnStyle(branchLoading || !newBranchName.trim())}
          >
            Create
          </button>
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--color-border-base)', marginBottom: 24 }} />

      {/* Pull & branch section */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Pull Latest & Create Branch
        </div>
        <div style={{ marginBottom: 8 }}>
          <MacSelect
            label="Base branch"
            options={branchOptions}
            value={pullBaseBranch}
            onChange={setPullBaseBranch}
            disabled={branchLoading}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <MacInput
              value={pullBranchName}
              onChange={setPullBranchName}
              placeholder="new-branch-name"
              mono
              disabled={branchLoading}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handlePullAndBranch(); } }}
            />
          </div>
          <button
            onClick={handlePullAndBranch}
            disabled={branchLoading || !pullBranchName.trim()}
            style={primaryBtnStyle(branchLoading || !pullBranchName.trim())}
          >
            Pull & Create
          </button>
        </div>
      </div>

      {error && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-error)', fontFamily: 'var(--font-sans)' }}>
          {error}
        </div>
      )}
    </MacSheet>
  );
}

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    height: 26,
    padding: '0 12px',
    border: 'none',
    borderRadius: 6,
    background: disabled ? 'var(--color-text-muted)' : 'var(--color-accent)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 500,
    fontFamily: 'var(--font-sans)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    flexShrink: 0,
    whiteSpace: 'nowrap',
  };
}
