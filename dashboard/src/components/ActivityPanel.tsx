import { useEffect, useRef, useState } from 'react';

export interface ActivityMessage {
  id: string;
  timestamp: number;
  type: string;
  source: string;
  message: string;
}

export interface ActivityPanelProps {
  messages: ActivityMessage[];
}

export function ActivityPanel({ messages }: ActivityPanelProps) {
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevMessagesLengthRef = useRef(0);

  useEffect(() => {
    if (autoScroll && containerRef.current && messages.length > prevMessagesLengthRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages, autoScroll]);

  const handleScroll = () => {
    if (!containerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 50;
    setAutoScroll(isAtBottom);
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getMessageClass = (type: string) => {
    switch (type.toLowerCase()) {
      case 'error':
        return 'error';
      case 'warning':
        return 'warning';
      case 'success':
        return 'success';
      case 'info':
      default:
        return 'info';
    }
  };

  return (
    <div className="panel activity-panel">
      <div className="panel-header">
        <h2>Activity Log</h2>
        <div className="panel-controls">
          <label className="auto-scroll-toggle">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>
          <span className="message-count">{messages.length} messages</span>
        </div>
      </div>
      <div className="activity-list" ref={containerRef} onScroll={handleScroll}>
        {messages.length === 0 ? (
          <div className="empty-state">No activity yet</div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`activity-item ${getMessageClass(msg.type)}`}>
              <span className="activity-time">{formatTime(msg.timestamp)}</span>
              <span className="activity-source">{msg.source}</span>
              <span className="activity-message">{msg.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
