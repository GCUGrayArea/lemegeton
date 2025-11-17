import { useMemo } from 'react';

export interface StatusPanelProps {
  state: any;
}

export function StatusPanel({ state }: StatusPanelProps) {
  const statusItems = useMemo(() => {
    if (!state) return [];

    return [
      {
        label: 'Mode',
        value: state.mode || 'UNKNOWN',
        status: state.mode === 'DISTRIBUTED' ? 'good' : 'warning',
      },
      {
        label: 'Redis',
        value: state.redis?.connected ? 'Connected' : 'Disconnected',
        status: state.redis?.connected ? 'good' : 'error',
      },
      {
        label: 'Active Agents',
        value: state.agents?.active || 0,
        status: (state.agents?.active || 0) > 0 ? 'good' : 'neutral',
      },
      {
        label: 'Active PRs',
        value: state.prs?.total || 0,
        status: 'neutral',
      },
    ];
  }, [state]);

  return (
    <div className="panel status-panel">
      <h2>System Status</h2>
      <div className="status-grid">
        {statusItems.map((item) => (
          <div key={item.label} className={`status-item status-${item.status}`}>
            <div className="status-label">{item.label}</div>
            <div className="status-value">{item.value}</div>
          </div>
        ))}
      </div>
      {state?.timestamp && (
        <div className="status-footer">
          Last updated: {new Date(state.timestamp).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
