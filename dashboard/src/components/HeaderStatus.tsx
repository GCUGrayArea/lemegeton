import React, { useMemo } from 'react';
import './HeaderStatus.css';

interface HeaderStatusProps {
  connectionState: 'connected' | 'reconnecting' | 'disconnected';
  reconnectAttempt: number;
  onReconnect: () => void;
  state: any;
}

const HeaderStatus: React.FC<HeaderStatusProps> = ({
  connectionState,
  reconnectAttempt,
  onReconnect,
  state,
}) => {
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
        label: 'Agents',
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

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'good': return 'status-good';
      case 'warning': return 'status-warning';
      case 'error': return 'status-error';
      default: return 'status-neutral';
    }
  };

  return (
    <div className="header-status-container">
      {/* Connection Status */}
      <div className={`connection-status status-${connectionState}`}>
        {connectionState === 'connected' && (
          <>
            <span className="status-indicator">●</span>
            <span>Connected</span>
          </>
        )}
        {connectionState === 'reconnecting' && (
          <>
            <span className="status-indicator">●</span>
            <span>Reconnecting... (attempt {reconnectAttempt})</span>
          </>
        )}
        {connectionState === 'disconnected' && (
          <>
            <span className="status-indicator">●</span>
            <span>Disconnected</span>
            <button className="reconnect-btn" onClick={onReconnect}>
              Reconnect
            </button>
          </>
        )}
      </div>

      {/* System Status */}
      {statusItems.length > 0 && (
        <div className="system-status-inline">
          {statusItems.map((item) => (
            <div key={item.label} className={`status-item ${getStatusClass(item.status)}`}>
              <span className="status-label">{item.label}:</span>
              <span className="status-value">{item.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default HeaderStatus;
