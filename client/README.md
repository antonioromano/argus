# Client

React frontend for Argus. Provides a dashboard of browser-based terminals connected to Claude Code sessions running on the server.

## Key Dependencies

- **React 19** + **React DOM**
- **@xterm/xterm** with WebGL renderer — terminal emulation in the browser
- **socket.io-client** — real-time terminal I/O and status updates
- **@dnd-kit** (core + sortable) — drag-and-drop session reordering

## Development

```bash
npm run dev -w client    # Vite dev server on port 5402
npm run build -w client  # TypeScript check + Vite build
npm run lint -w client   # ESLint
```

## Vite Proxy

In development, Vite proxies these paths to the server at `http://localhost:5401`:

- `/api` — REST endpoints (session CRUD, filesystem browsing)
- `/socket.io` — WebSocket transport for terminal I/O

See `vite.config.ts` for the proxy configuration.

## Structure

```
src/
├── App.tsx                        # Top-level layout, theme toggle, focus mode
├── main.tsx                       # Entry point
├── components/
│   ├── Dashboard.tsx              # Session card grid with drag-and-drop
│   ├── TerminalPanel.tsx          # xterm.js terminal wired to Socket.io
│   ├── CreateSessionModal.tsx     # New session dialog
│   ├── SessionGroup.tsx           # Grouped session display
│   ├── PathAutocomplete.tsx       # Directory path input with autocomplete
│   └── FolderTree.tsx             # Directory tree browser
├── hooks/
│   ├── useSocket.ts               # Singleton Socket.io client
│   ├── useSessions.ts             # Session list synced via REST + Socket.io
│   ├── useSessionOrder.ts         # Persisted drag-and-drop ordering
│   └── useTerminal.ts             # xterm.js lifecycle management
└── services/
    └── api.ts                     # REST API client
```

## Communication

The client communicates with the server through two channels:

- **REST** (`/api/sessions`, `/api/filesystem`) — session CRUD, path autocomplete, directory browsing
- **Socket.io** — joining/leaving session rooms, streaming terminal input/output, receiving status changes and exit events

Shared TypeScript types in `@argus/shared` ensure type safety for both channels.
