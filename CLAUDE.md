# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This is a greenfield self-hosted Windows chat platform with two executables: a Go server (`chatserver.exe`) and a native Windows client (`chatclient.exe`). Neither has been implemented yet — consult the spec files before writing any code.

## Reference Files (read before implementing)

- **CHATSERVER.md** — Master spec: phases, tasks, security priorities, Windows-specific details.
- **PROTOCOL.md** — WebSocket message format. Every message type, payload shape, and rate limit. Server and client must agree on this exactly.
- **SCHEMA.md** — SQLite table definitions, indexes, FTS5 setup, permission bitfield definitions. Use these exact definitions.
- **API.md** — REST endpoints, request/response shapes, error codes.
- **SETUP.md** — What tooling is installed and what Claude Code should install.

## Project Structure

```
OwnCord/
├── Server/              ← Go server (chatserver.exe) — not yet created
├── Client/              ← Native Windows client — not yet created
└── docs/                ← Quick-start, port-forwarding, Tailscale guides
```

When scaffolding the server, create packages under `Server/`: `config/`, `db/`, `auth/`, `api/`, `ws/`, `voice/`, `storage/`, `admin/static/`, `migrations/`.

## Build Commands

### Server
```bash
cd Server
go build -o chatserver.exe -ldflags "-s -w -X main.version=1.0.0" .

# Cross-compile for Windows from another OS
GOOS=windows GOARCH=amd64 go build -o chatserver.exe -ldflags "-s -w -X main.version=1.0.0" .
```

### Dev Tools (Claude Code installs these)
```bash
# Hot reload during development
go install github.com/air-verse/air@latest
air  # from Server/ directory

# Linter
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
golangci-lint run ./...

# SQL code generator (optional)
go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
```

### Tests
```bash
cd Server
go test ./...                        # all tests
go test ./auth/... -v                # single package, verbose
go test ./... -run TestFunctionName  # single test
go test ./... -cover                 # with coverage
```

## Phase Order

Build in the order listed in CHATSERVER.md:
1. Protocol & Server Core
2. Auth & Security
3. Client Core UI
4. Real-Time Chat Features
5. Voice & Video
6. Admin Panel
7. Distribution & Updates

Phases 1–2 (server) and Phase 3 (client UI shell) can be worked on in parallel once the protocol is defined.

## Server Conventions (Go)

- Use standard library where possible. Minimize dependencies.
- Router: `chi`. SQLite: `modernc.org/sqlite` (pure Go, no CGO). WebSocket: `nhooyr.io/websocket`. WebRTC: `pion/webrtc` + `pion/turn`.
- Config via `config.yaml` loaded at startup; environment variable overrides for Docker.
- Structured logging via `log/slog`.
- Errors returned as JSON `{ "error": "CODE", "message": "detail" }`.
- All user input sanitized server-side with `bluemonday` before storage and broadcast.
- Passwords hashed with bcrypt cost 12+. Sessions are server-side tokens in SQLite — not JWTs.
- Every API handler and WebSocket event checks permissions using the bitfield system defined in SCHEMA.md.
- File uploads: validate magic bytes, reject executables, strip EXIF, store with UUID filename.
- Embed admin panel static files with `//go:embed admin/static`.
- Target: `GOOS=windows GOARCH=amd64`.

## Client Conventions

- Native Windows desktop app. No Electron. No browser engine. ~20–40MB install, ~50–100MB idle RAM.
- Store auth tokens in Windows Credential Manager (DPAPI).
- Windows-native APIs: `SetWindowsHookEx` (push-to-talk), WASAPI (audio), DXGI (screen capture), Toast notifications.
- WebSocket for real-time + REST for history/uploads. Follow PROTOCOL.md exactly.
- Support multiple server profiles (like TeamSpeak bookmarks).
- Installer via NSIS or WiX. Register `chatserver://` protocol handler.

## Security Rules

- Never trust client input — all validation server-side.
- Never log passwords, tokens, or message content in plaintext.
- Never expose the upload directory directly — always serve through auth middleware.
- Never reveal whether a username exists on failed login — generic error only.
- Rate limit everything: logins, messages, uploads, API calls.
- All WebSocket connections must authenticate before receiving any data.
- TLS on by default (self-signed cert generated on first run).
- Invite-only registration — no open signup endpoint.
