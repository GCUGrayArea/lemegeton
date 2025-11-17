import { useState, useCallback } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { StatusPanel } from './components/StatusPanel';
import { PRPanel } from './components/PRPanel';
import { ActivityPanel, ActivityMessage } from './components/ActivityPanel';
import './App.css';

const MAX_ACTIVITY_MESSAGES = 100;

function App() {
  const [state, setState] = useState<any>(null);
  const [activityMessages, setActivityMessages] = useState<ActivityMessage[]>([]);

  const handleMessage = useCallback((message: any) => {
    try {
      console.log('[Dashboard] Received message type:', message.type);

      switch (message.type) {
        case 'initial-state':
        case 'state-update':
          console.log('[Dashboard] Setting state with data:', Object.keys(message.data || {}));
          setState(message.data);
          console.log('[Dashboard] State set successfully');
          break;

        case 'hub-message':
        case 'agent-update':
        case 'tui-update':
          // Add to activity log (limit to prevent flooding)
          setActivityMessages((prev) => {
            const newMessage: ActivityMessage = {
              id: `${Date.now()}-${Math.random()}`,
              timestamp: Date.now(),
              type: message.type,
              source: message.data?.from || message.channel || 'system',
              message: JSON.stringify(message.data?.payload || message.data || message),
            };
            const updated = [...prev, newMessage];
            // Keep only last MAX_ACTIVITY_MESSAGES
            return updated.slice(-MAX_ACTIVITY_MESSAGES);
          });
          break;

        case 'error':
          console.error('[Dashboard] Server error:', message.error);
          setActivityMessages((prev) => {
            const newMessage: ActivityMessage = {
              id: `${Date.now()}-${Math.random()}`,
              timestamp: Date.now(),
              type: 'error',
              source: 'system',
              message: message.error,
            };
            const updated = [...prev, newMessage];
            return updated.slice(-MAX_ACTIVITY_MESSAGES);
          });
          break;

        default:
          console.warn('[Dashboard] Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('[Dashboard] Error handling message:', error);
      console.error('[Dashboard] Problematic message:', message);
    }
  }, []);

  const handleOpen = useCallback(() => {
    console.log('[Dashboard] Connected to server');
    // Only log connection if we don't have a recent disconnect message
    setActivityMessages((prev) => {
      const lastMsg = prev[prev.length - 1];
      const recentDisconnect = lastMsg &&
        lastMsg.message.includes('disconnected') &&
        Date.now() - lastMsg.timestamp < 5000;

      if (!recentDisconnect) {
        const newMessage: ActivityMessage = {
          id: `${Date.now()}-${Math.random()}`,
          timestamp: Date.now(),
          type: 'success',
          source: 'dashboard',
          message: 'WebSocket connected to dashboard server',
        };
        return [...prev, newMessage].slice(-MAX_ACTIVITY_MESSAGES);
      }
      return prev;
    });
  }, []);

  const handleClose = useCallback(() => {
    console.log('[Dashboard] Disconnected from server');
    // Throttle disconnect messages
    setActivityMessages((prev) => {
      const lastMsg = prev[prev.length - 1];
      const recentDisconnect = lastMsg &&
        lastMsg.message.includes('disconnected') &&
        Date.now() - lastMsg.timestamp < 5000;

      if (!recentDisconnect) {
        const newMessage: ActivityMessage = {
          id: `${Date.now()}-${Math.random()}`,
          timestamp: Date.now(),
          type: 'warning',
          source: 'dashboard',
          message: 'WebSocket disconnected from server',
        };
        return [...prev, newMessage].slice(-MAX_ACTIVITY_MESSAGES);
      }
      return prev;
    });
  }, []);

  // Construct WebSocket URL - same host and port as HTTP
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}`;

  const { state: wsState, reconnect } = useWebSocket({
    url: wsUrl,
    reconnectInterval: 5000, // 5 seconds between reconnect attempts
    maxReconnectAttempts: 5,  // Only try 5 times before giving up
    onMessage: handleMessage,
    onOpen: handleOpen,
    onClose: handleClose,
  });

  return (
    <div className="app">
      <header className="app-header">
        <h1>Lemegeton Dashboard</h1>
        <div className="connection-status">
          {wsState.isConnected ? (
            <span className="status-connected">WebSocket Connected</span>
          ) : wsState.isReconnecting ? (
            <span className="status-reconnecting">
              Reconnecting... (attempt {wsState.reconnectAttempt})
            </span>
          ) : (
            <span className="status-disconnected">
              WebSocket Disconnected
              <button onClick={reconnect} className="reconnect-btn">
                Reconnect
              </button>
            </span>
          )}
        </div>
      </header>

      <main className="app-main">
        <div className="top-panels">
          <StatusPanel state={state} />
          <PRPanel state={state} />
        </div>
        <div className="bottom-panel">
          <ActivityPanel messages={activityMessages} />
        </div>
      </main>

      {wsState.error && (
        <div className="error-banner">
          Error: {wsState.error}
        </div>
      )}
    </div>
  );
}

export default App;
