import { useMemo, useState } from 'react';

export interface PRPanelProps {
  state: any;
}

export function PRPanel({ state }: PRPanelProps) {
  const [selectedPR, setSelectedPR] = useState<string | null>(null);

  const prs = useMemo(() => {
    if (!state?.prs?.details) return [];

    return Object.entries(state.prs.details).map(([id, pr]: [string, any]) => ({
      id,
      ...pr,
    }));
  }, [state]);

  const getStatusIcon = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'completed':
        return '✓';
      case 'in_progress':
        return '▶';
      case 'blocked':
        return '●';
      case 'pending':
        return '○';
      default:
        return '?';
    }
  };

  const getStatusClass = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'completed':
        return 'completed';
      case 'in_progress':
        return 'in-progress';
      case 'blocked':
        return 'blocked';
      case 'pending':
        return 'pending';
      default:
        return 'unknown';
    }
  };

  return (
    <div className="panel pr-panel">
      <h2>Pull Requests ({prs.length})</h2>
      <div className="pr-list">
        {prs.length === 0 ? (
          <div className="empty-state">No active PRs</div>
        ) : (
          prs.map((pr) => (
            <div
              key={pr.id}
              className={`pr-item ${getStatusClass(pr.status)} ${selectedPR === pr.id ? 'selected' : ''}`}
              onClick={() => setSelectedPR(selectedPR === pr.id ? null : pr.id)}
            >
              <div className="pr-header">
                <span className="pr-icon">{getStatusIcon(pr.status)}</span>
                <span className="pr-id">{pr.id}</span>
                <span className="pr-title">{pr.title || 'Untitled'}</span>
              </div>
              {selectedPR === pr.id && (
                <div className="pr-details">
                  {pr.description && <p className="pr-description">{pr.description}</p>}
                  {pr.assignedTo && (
                    <div className="pr-meta">
                      <strong>Assigned to:</strong> {pr.assignedTo}
                    </div>
                  )}
                  {pr.progress !== undefined && (
                    <div className="pr-progress">
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${pr.progress}%` }} />
                      </div>
                      <span className="progress-text">{pr.progress}%</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
