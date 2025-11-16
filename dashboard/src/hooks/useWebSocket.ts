import { useEffect, useRef, useState, useCallback } from 'react';

export interface WebSocketMessage {
  type: string;
  data?: any;
  channel?: string;
  error?: string;
}

export interface UseWebSocketOptions {
  url: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
  onMessage?: (message: WebSocketMessage) => void;
}

export interface UseWebSocketReturn {
  state: WebSocketState;
  lastMessage: WebSocketMessage | null;
  send: (message: any) => void;
  reconnect: () => void;
}

export interface WebSocketState {
  isConnected: boolean;
  isReconnecting: boolean;
  reconnectAttempt: number;
  error: string | null;
}

export function useWebSocket(options: UseWebSocketOptions): UseWebSocketReturn {
  const {
    url,
    reconnectInterval = 3000,
    maxReconnectAttempts = 10,
    onOpen,
    onClose,
    onError,
    onMessage,
  } = options;

  const [state, setState] = useState<WebSocketState>({
    isConnected: false,
    isReconnecting: false,
    reconnectAttempt: 0,
    error: null,
  });

  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const shouldReconnectRef = useRef(true);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        console.log('[WebSocket] Connected');
        setState({
          isConnected: true,
          isReconnecting: false,
          reconnectAttempt: 0,
          error: null,
        });
        onOpen?.();
      };

      ws.onclose = () => {
        console.log('[WebSocket] Disconnected');
        setState((prev) => ({
          ...prev,
          isConnected: false,
        }));
        onClose?.();

        // Attempt reconnect if enabled
        if (shouldReconnectRef.current) {
          setState((prev) => {
            if (prev.reconnectAttempt < maxReconnectAttempts) {
              console.log(
                `[WebSocket] Reconnecting... (attempt ${prev.reconnectAttempt + 1}/${maxReconnectAttempts})`
              );

              reconnectTimeoutRef.current = setTimeout(() => {
                connect();
              }, reconnectInterval);

              return {
                ...prev,
                isReconnecting: true,
                reconnectAttempt: prev.reconnectAttempt + 1,
              };
            } else {
              console.error('[WebSocket] Max reconnect attempts reached');
              return {
                ...prev,
                isReconnecting: false,
                error: 'Max reconnect attempts reached',
              };
            }
          });
        }
      };

      ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
        setState((prev) => ({
          ...prev,
          error: 'WebSocket error occurred',
        }));
        onError?.(error);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          setLastMessage(message);
          onMessage?.(message);
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
        }
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('[WebSocket] Connection failed:', error);
      setState((prev) => ({
        ...prev,
        error: 'Failed to connect',
      }));
    }
  }, [url, reconnectInterval, maxReconnectAttempts, onOpen, onClose, onError, onMessage]);

  const send = useCallback((message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn('[WebSocket] Cannot send message - not connected');
    }
  }, []);

  const reconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    wsRef.current?.close();
    setState({
      isConnected: false,
      isReconnecting: false,
      reconnectAttempt: 0,
      error: null,
    });

    connect();
  }, [connect]);

  useEffect(() => {
    shouldReconnectRef.current = true;
    connect();

    return () => {
      shouldReconnectRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, [connect]);

  return {
    state,
    lastMessage,
    send,
    reconnect,
  };
}
