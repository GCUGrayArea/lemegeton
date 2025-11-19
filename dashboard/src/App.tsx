import { useState, useCallback } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { ActivityMessage } from './components/ActivityPanel';
import { MetricsPanel } from './components/MetricsPanel';
import { DependencyGraphFlow } from './components/DependencyGraphFlow';
import { useProgressMetrics } from './hooks/useProgressMetrics';
import Drawer from './components/Drawer';
import HeaderStatus from './components/HeaderStatus';
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

  // Transform state data for progress metrics
  // Server sends: { prs: { total: N, details: { 'PR-001': {...}, ... } } }
  // Components need: prs array and states map
  const prsArray = state?.prs?.details
    ? Object.values(state.prs.details).map((pr: any) => ({
        pr_id: pr.id,
        title: pr.title,
        cold_state: pr.cold_state,
        dependencies: pr.dependencies || [],
        complexity: pr.complexity || { score: 5, estimated_minutes: 60, suggested_model: 'sonnet' },
      }))
    : null;

  const prStates = state?.prs?.details
    ? Object.fromEntries(
        Object.entries(state.prs.details).map(([id, pr]: [string, any]) => [
          id,
          { coldState: pr.cold_state, hotState: pr.hot_state },
        ])
      )
    : null;

  // Calculate progress metrics from state
  const metrics = useProgressMetrics({
    prs: prsArray,
    states: prStates,
    velocityPRsPerDay: 2, // Default velocity
  });

  return (
    <div className="app">
      <header className="app-header">
        <h1>Lemegeton Dashboard</h1>
        <HeaderStatus
          connectionState={
            wsState.isConnected ? 'connected' :
            wsState.isReconnecting ? 'reconnecting' :
            'disconnected'
          }
          reconnectAttempt={wsState.reconnectAttempt}
          onReconnect={reconnect}
          state={state}
        />
      </header>

      <Drawer
        state={state}
        phaseProgress={metrics.phaseProgress}
        activityMessages={activityMessages}
      />

      <main className="app-main">
        {/* Progress Tracking Panels */}
        <div className="progress-section">
          <MetricsPanel metrics={metrics} />
          <DependencyGraphFlow
            prs={prsArray || []}
            dependencyGraph={metrics.dependencyGraph}
            criticalPath={metrics.criticalPath}
          />
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
