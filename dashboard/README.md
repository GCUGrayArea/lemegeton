# Lemegeton Web Dashboard

A modern, real-time web dashboard for monitoring Lemegeton agents, PRs, and system status.

## Features

- **Real-time updates** via WebSocket connection
- **System status** panel showing coordination mode, Redis health, active agents, and PRs
- **PR tracking** with expandable details, status indicators, and progress bars
- **Activity log** with auto-scroll and message filtering
- **Graceful degradation** - stays responsive even when hub is offline
- **Clean, GitHub-inspired UI** with dark theme

## Quick Start

### 1. Install Dependencies

```bash
cd dashboard
npm install
```

### 2. Build Frontend

```bash
npm run build
```

This creates a production build in `dashboard/dist/` that the server will serve.

### 3. Install Server Dependencies

```bash
# From project root
npm install
```

### 4. Start Dashboard

```bash
# From project root
npm run build
lemegeton dashboard
```

The dashboard will be available at `http://localhost:3000`

## Development Mode

For frontend development with hot reload:

```bash
# Terminal 1: Start the dashboard server
lemegeton dashboard

# Terminal 2: Start Vite dev server
cd dashboard
npm run dev
```

Then open `http://localhost:3001` (Vite dev server with hot reload)

## CLI Options

```bash
lemegeton dashboard [options]

Options:
  -p, --port <number>       HTTP server port (default: 3000)
  -H, --host <host>         HTTP server host (default: localhost)
  --static-path <path>      Path to static files (default: dashboard/dist)
  -h, --help               Display help
```

## Architecture

```
┌─────────────────────────────────────────────┐
│         React Frontend (Browser)            │
│  ┌──────────┬───────────┬────────────────┐ │
│  │  Status  │  PR List  │  Activity Log  │ │
│  └──────────┴───────────┴────────────────┘ │
└─────────────────┬───────────────────────────┘
                  │ WebSocket
                  ▼
┌─────────────────────────────────────────────┐
│      Dashboard Server (Express + WS)        │
│  ┌────────────────┬────────────────────┐   │
│  │  HTTP Server   │  WebSocket Server  │   │
│  └────────────────┴────────────────────┘   │
└─────────────────┬───────────────────────────┘
                  │ Redis Pub/Sub
                  ▼
┌─────────────────────────────────────────────┐
│              Redis + Message Bus             │
│  ┌─────────────────────────────────────┐   │
│  │  Hub, Agents, State, Events         │   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

## Key Components

### Server (`src/dashboard/server.ts`)
- Express HTTP server for serving static files
- WebSocket server for real-time communication
- Subscribes to Redis channels for state updates
- Broadcasts updates to all connected clients

### Frontend
- **useWebSocket hook** - Manages WebSocket connection with auto-reconnect
- **StatusPanel** - Displays coordination mode, Redis health, agents, PRs
- **PRPanel** - Shows PR list with clickable items for details
- **ActivityPanel** - Real-time activity feed with auto-scroll

## Comparison with TUI

| Feature | TUI (Terminal) | Dashboard (Web) |
|---------|---------------|-----------------|
| **Input handling** | Terminal escape sequences (problematic) | HTML forms (robust) |
| **Navigation** | Keyboard only | Click + keyboard |
| **Multiple viewers** | No | Yes (multiple browsers) |
| **Shutdown handling** | Blocks on hub offline | Graceful degradation |
| **Development** | Blessed library | React + Vite |
| **Deployment** | Terminal required | Browser-based |
| **Accessibility** | Limited | Better (web standards) |

## Troubleshooting

### Dashboard won't start

**Problem**: `Failed to start dashboard: Error: Redis client not connected`

**Solution**: Make sure Redis is running and accessible:
```bash
redis-cli ping  # Should return PONG
```

### Frontend not loading

**Problem**: 404 errors when accessing dashboard

**Solution**: Build the frontend first:
```bash
cd dashboard
npm run build
```

### WebSocket connection fails

**Problem**: "WebSocket error occurred" in browser console

**Solution**:
- Check that the dashboard server is running
- Verify the WebSocket URL matches your server (check browser dev tools)
- Ensure no firewall blocking WebSocket connections

### No updates showing

**Problem**: Dashboard loads but no data appears

**Solution**:
- Check that the hub is running: `lemegeton hub status`
- Verify Redis is populated with data
- Check browser console for errors

## Future Enhancements

Potential improvements:
- [ ] Authentication/authorization
- [ ] Multi-user support with user-specific views
- [ ] Historical data visualization (charts, graphs)
- [ ] Export functionality (CSV, JSON)
- [ ] Agent control panel (start/stop agents)
- [ ] Custom dashboard layouts
- [ ] Mobile-responsive design improvements
- [ ] Dark/light theme toggle

## License

MIT
