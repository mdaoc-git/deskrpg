# Multi-Adapter NPC Agent — Phase 2A: CLI Adapters

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Enable DeskRPG NPC agents to use Claude Code, Codex CLI, Gemini CLI, and OpenCode as backends via subprocess execution, with workspace-based persona injection and streaming response handling.

**Architecture:** Create a SubprocessPool for managed child process execution (spawn + stdin pipe), a CliBaseAdapter abstract class with shared subprocess logic, four concrete CLI adapter implementations, a WorkspaceManager for persona file generation, and wire everything into socket-handlers so CLI-backed NPCs can chat, do tasks, and join meetings.

**Tech Stack:** TypeScript, Node.js child_process (spawn only — no shell), Node.js test runner

**Spec:** docs/superpowers/specs/2026-04-09-multi-adapter-npc-agent-design.md sections 5, 7, 9

**Depends on:** Phase 1 (AdapterRegistry, OpenClawAdapter, NpcConfig.adapterType) — already merged.

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | src/lib/adapters/subprocess-pool.ts | Managed subprocess spawning with concurrency limits |
| Create | src/lib/adapters/subprocess-pool.test.ts | SubprocessPool unit tests |
| Create | src/lib/adapters/cli-base-adapter.ts | Abstract base class for CLI adapters |
| Create | src/lib/adapters/cli-base-adapter.test.ts | CliBaseAdapter tests (using a TestAdapter subclass) |
| Create | src/lib/adapters/claude-adapter.ts | Claude Code adapter |
| Create | src/lib/adapters/codex-adapter.ts | Codex CLI adapter |
| Create | src/lib/adapters/gemini-adapter.ts | Gemini CLI adapter |
| Create | src/lib/adapters/opencode-adapter.ts | OpenCode adapter |
| Create | src/lib/adapters/cli-adapters.test.ts | Tests for all 4 CLI adapters |
| Create | src/lib/adapters/workspace-manager.ts | Workspace directory + persona file management |
| Create | src/lib/adapters/workspace-manager.test.ts | WorkspaceManager tests |
| Modify | src/server/socket-handlers.ts:70-72,608-611 | Register CLI adapters, remove unsupported guard |

---

### Task 1: SubprocessPool

**Files:**
- Create: src/lib/adapters/subprocess-pool.ts
- Create: src/lib/adapters/subprocess-pool.test.ts

- [ ] Step 1: Write tests for SubprocessPool — spawn a simple command (echo/node -e), verify stdout collection, stdin piping, timeout killing, concurrency queueing, exit code capture
- [ ] Step 2: Run tests — expect fail (module not found)
- [ ] Step 3: Implement SubprocessPool class using child_process.spawn (never shell). stdin pipe for prompt. stdout/stderr collection. Timeout with SIGTERM then SIGKILL. Concurrency limit with queue. getStatus() for monitoring. kill(requestId) for abort.
- [ ] Step 4: Run tests — expect all pass
- [ ] Step 5: Commit — "feat(adapters): add SubprocessPool with concurrency and timeout management"

Key implementation details:
- Use spawn() with stdio: ["pipe", "pipe", "pipe"] — never pass user input as shell args
- proc.stdin.write(input) + proc.stdin.end() for prompt injection
- Default maxConcurrent=10, timeoutMs=180000
- Timeout: SIGTERM first, then SIGKILL after 5 seconds
- Queue pattern: if active >= maxConcurrent, push to queue array, drain on process exit

---

### Task 2: WorkspaceManager

**Files:**
- Create: src/lib/adapters/workspace-manager.ts
- Create: src/lib/adapters/workspace-manager.test.ts

- [ ] Step 1: Write tests — ensureWorkspace creates directory, writePersonaFiles creates correct file per adapter type (CLAUDE.md for claude, AGENTS.md for codex/opencode, GEMINI.md for gemini), getUserAuthHome returns user-specific path
- [ ] Step 2: Run tests — expect fail
- [ ] Step 3: Implement WorkspaceManager: ensureWorkspace(projectId) creates /tmp/deskrpg-workspaces/{projectId}/ (use os.tmpdir() + deskrpg prefix for dev, configurable via env DESKRPG_DATA_DIR for prod). writePersonaFiles(wsPath, adapterType, persona, locale) writes the correct file. getUserAuthHome(userId) returns user-isolated HOME path. Use existing injectTaskPrompt and localizeNpcPromptDocument from task-prompt.js and npc-agent-defaults.ts.
- [ ] Step 4: Run tests — expect all pass
- [ ] Step 5: Commit — "feat(adapters): add WorkspaceManager for persona files and auth isolation"

---

### Task 3: CliBaseAdapter

**Files:**
- Create: src/lib/adapters/cli-base-adapter.ts
- Create: src/lib/adapters/cli-base-adapter.test.ts

- [ ] Step 1: Write tests using a concrete TestAdapter subclass that wraps "node -e" as the CLI command. Test: execute() returns response text, streaming onDelta works, session lookup/save via npc_sessions (mock or in-memory for now), testConnection checks if command exists.
- [ ] Step 2: Run tests — expect fail
- [ ] Step 3: Implement CliBaseAdapter abstract class. Properties: type, cliCommand. Abstract methods: buildArgs(options, sessionRef?), parseStreamChunk(raw), extractSessionId(result). Concrete: execute() orchestrates SubprocessPool.execute with workspace cwd, user HOME env, stdin prompt. testConnection() runs cliCommand --version. getSessionSummary() sends summary request prompt to same session.
- [ ] Step 4: Run tests — expect all pass
- [ ] Step 5: Commit — "feat(adapters): add CliBaseAdapter abstract class"

Key details:
- execute() flow: lookupSession → prepareWorkspace → buildArgs → subprocessPool.execute({ command, args, cwd, env: { HOME: userAuthHome }, stdin: prompt }) → extractSessionId → saveSession → return
- For Phase 2A, session storage is in-memory Map (Phase 3 adds npc_sessions DB table)
- testConnection uses execFileNoThrow (from src/utils/execFileNoThrow.ts) for version check

---

### Task 4: Four CLI Adapters

**Files:**
- Create: src/lib/adapters/claude-adapter.ts
- Create: src/lib/adapters/codex-adapter.ts
- Create: src/lib/adapters/gemini-adapter.ts
- Create: src/lib/adapters/opencode-adapter.ts
- Create: src/lib/adapters/cli-adapters.test.ts

- [ ] Step 1: Write tests for all four adapters — buildArgs returns correct flags, parseStreamChunk extracts text from JSON/text output, type is correct string

- [ ] Step 2: Run tests — expect fail

- [ ] Step 3: Implement ClaudeAdapter:
  - type = "claude", cliCommand = "claude"
  - buildArgs: ["-p", "-", "--output-format", "stream-json", "--dangerously-skip-permissions"]. Add --model if set. Add --resume sessionRef if resuming.
  - parseStreamChunk: parse JSON line, extract content from assistant type events
  - extractSessionId: parse session id from stream-json output

- [ ] Step 4: Implement CodexAdapter:
  - type = "codex", cliCommand = "codex"
  - buildArgs: ["exec", "--dangerously-bypass-approvals-and-sandbox", "-"]. Add resume if sessionRef.
  - parseStreamChunk: return raw text
  - extractSessionId: parse from output

- [ ] Step 5: Implement GeminiAdapter:
  - type = "gemini", cliCommand = "gemini"
  - buildArgs: ["-p", "-", "-o", "stream-json", "--approval-mode", "yolo"]. Add -m model. Add --resume latest if sessionRef.
  - parseStreamChunk: parse JSON, extract content
  - extractSessionId: parse from output

- [ ] Step 6: Implement OpenCodeAdapter:
  - type = "opencode", cliCommand = "opencode"
  - buildArgs: ["run", "--format", "json", "-"]. Add -s sessionRef if resuming.
  - parseStreamChunk: parse JSON, extract content
  - extractSessionId: parse from output

- [ ] Step 7: Run tests — expect all pass
- [ ] Step 8: Commit — "feat(adapters): add Claude, Codex, Gemini, OpenCode adapters"

---

### Task 5: Register CLI Adapters in Socket Handlers

**Files:**
- Modify: src/server/socket-handlers.ts:56-72 (imports + registry initialization)
- Modify: src/server/socket-handlers.ts:601-638 (streamNpcResponse)
- Modify: src/server/socket-handlers.ts:365-367 (nudge guard)

- [ ] Step 1: Import all CLI adapters. Conditionally register based on availability (try testConnection, register if ok).
- [ ] Step 2: Update streamNpcResponse: replace the hard "unsupported_adapter" guard with adapter registry lookup. For openclaw, keep the existing executeWithGateway path. For CLI adapters, call adapter.execute() directly.
- [ ] Step 3: Apply same pattern to streamMeetingNpcResponse and runProgressNudgeForTask
- [ ] Step 4: Run all existing tests to verify no regressions
- [ ] Step 5: Commit — "feat(adapters): register CLI adapters and enable routing in socket handlers"

Key change in streamNpcResponse:
```
// Before (Phase 1):
if (!adapterRegistry.has(adapterType) || adapterType !== openclawAdapter.type) {
  emitNpcSystemResponse(socket, npcId, "unsupported_adapter");
  return "";
}
// gateway path...

// After (Phase 2A):
if (adapterType === "openclaw") {
  // existing gateway path
} else if (adapterRegistry.has(adapterType)) {
  const adapter = adapterRegistry.get(adapterType);
  const result = await adapter.execute({
    sessionKey, prompt: message, onDelta, model, userId, projectId, locale
  });
  socket.emit(responseEvent, { npcId, chunk: "", done: true });
  return result.response;
} else {
  emitNpcSystemResponse(socket, npcId, "unsupported_adapter");
  return "";
}
```

---

### Task 6: Integration Tests

**Files:**
- Create: src/lib/adapters/phase2a-integration.test.ts

- [ ] Step 1: Write integration tests covering:
  - All 4 CLI adapters registered in fresh registry
  - buildArgs output for each adapter with/without model/session
  - WorkspaceManager creates correct persona files for each adapter type
  - SubprocessPool executes a real command (node -e "process.stdout.write('hello')")
  - End-to-end: CliBaseAdapter subclass (TestAdapter) → SubprocessPool → response
- [ ] Step 2: Run tests — expect all pass
- [ ] Step 3: Run full test suite (Phase 1 + Phase 2A + existing)
- [ ] Step 4: Commit — "test: add Phase 2A integration tests for CLI adapter pipeline"

---

## Phase Summary

After completing all 6 tasks:

**New files (12):**
- src/lib/adapters/subprocess-pool.ts + test
- src/lib/adapters/cli-base-adapter.ts + test
- src/lib/adapters/claude-adapter.ts
- src/lib/adapters/codex-adapter.ts
- src/lib/adapters/gemini-adapter.ts
- src/lib/adapters/opencode-adapter.ts
- src/lib/adapters/cli-adapters.test.ts
- src/lib/adapters/workspace-manager.ts + test
- src/lib/adapters/phase2a-integration.test.ts

**Modified files (1):**
- src/server/socket-handlers.ts (CLI adapter registration + routing)

**Result:** CLI-backed NPCs can chat, work tasks, and join meetings. Auth uses environment variables (ANTHROPIC_API_KEY etc). Phase 2B adds encrypted provider storage + OAuth.

## Next Plans

- Phase 2B: provider_resources DB, Provider API, CLI OAuth login, health check endpoints
- Phase 3: DM Hub, cross-session context, npc_sessions DB
- Phase 4: UI + Docker
