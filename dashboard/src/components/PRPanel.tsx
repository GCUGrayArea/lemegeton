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

  const getStatusIcon = (coldState: string) => {
    switch (coldState?.toLowerCase()) {
      case 'completed':
        return '✓';
      case 'in_progress':
        return '▶';
      case 'blocked':
        return '●';
      case 'new':
      case 'deferred':
        return '○';
      case 'failed':
        return '✗';
      default:
        return '?';
    }
  };

  const getStatusClass = (coldState: string) => {
    switch (coldState?.toLowerCase()) {
      case 'completed':
        return 'completed';
      case 'in_progress':
        return 'in-progress';
      case 'blocked':
        return 'blocked';
      case 'new':
      case 'deferred':
        return 'pending';
      case 'failed':
        return 'failed';
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
              className={`pr-item ${getStatusClass(pr.cold_state)} ${selectedPR === pr.id ? 'selected' : ''}`}
              onClick={() => setSelectedPR(selectedPR === pr.id ? null : pr.id)}
            >
              <div className="pr-header">
                <span className="pr-icon">{getStatusIcon(pr.cold_state)}</span>
                <span className="pr-id">{pr.id}</span>
                <span className="pr-title">{pr.title || 'Untitled'}</span>
              </div>
              {selectedPR === pr.id && (
                <div className="pr-details">
                  <div className="pr-meta">
                    <strong>Status:</strong> {pr.cold_state}
                  </div>
                  <div className="pr-meta">
                    <strong>Priority:</strong> {pr.priority}
                  </div>
                  {pr.complexity && (
                    <div className="pr-meta">
                      <strong>Complexity:</strong> {pr.complexity.score}/10 ({pr.complexity.suggested_model})
                    </div>
                  )}
                  {pr.dependencies && pr.dependencies.length > 0 && (
                    <div className="pr-meta">
                      <strong>Dependencies:</strong> {pr.dependencies.join(', ')}
                    </div>
                  )}
                  {pr.estimated_files && pr.estimated_files > 0 && (
                    <div className="pr-meta">
                      <strong>Files:</strong> {pr.estimated_files} estimated
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
