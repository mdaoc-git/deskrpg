# Multi-Adapter NPC Agent — Phase 1: Adapter Abstraction Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Introduce an Adapter Registry that abstracts the NPC agent backend, wrap the existing OpenClaw integration as the first adapter, and refactor socket handlers to route through the registry — all without changing any external behavior.

**Architecture:** Define an NpcAdapter interface in src/lib/adapters/types.ts, create an AdapterRegistry in the same file, wrap the existing OpenClawGateway as OpenClawAdapter, add adapter_type and adapter_config columns to the npcs table, and update socket-handlers.ts to resolve adapters via the registry instead of calling OpenClawGateway directly. The existing openclawConfig column is preserved for backward compatibility.

**Tech Stack:** TypeScript, Drizzle ORM (PostgreSQL + SQLite), Socket.IO, Node.js test runner

**Spec:** docs/superpowers/specs/2026-04-09-multi-adapter-npc-agent-design.md sections 2-4, 9

**Phase Scope:** This plan only covers the abstraction layer. CLI adapters (Phase 2), DM Hub (Phase 3), and UI (Phase 4) are separate plans.

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | src/lib/adapters/types.ts | NpcAdapter interface, types, AdapterRegistry |
| Create | src/lib/adapters/types.test.ts | Registry unit tests |
| Create | src/lib/adapters/openclaw-adapter.ts | OpenClawAdapter wrapping existing gateway |
| Create | src/lib/adapters/openclaw-adapter.test.ts | OpenClawAdapter unit tests |
| Modify | src/db/schema.ts:217-231 | Add adapter_type, adapter_config to npcs |
| Modify | src/db/schema-sqlite.ts | Same for SQLite schema |
| Modify | src/db/sqlite-base-schema.js | Same for runtime SQLite bootstrap |
| Modify | src/server/socket-handlers.ts:85-94 | Extend NpcConfig with adapterType |
| Modify | src/server/socket-handlers.ts:460-616 | Use adapter registry instead of direct gateway |
| Modify | src/server/socket-handlers.ts:347-415 | Nudge flow through adapter |
| Modify | src/server/meeting-discussion.ts | adapterResolver for MeetingBroker |
| Modify | src/lib/meeting-broker.js | Accept adapterResolver instead of single gateway |

---

### Task 1: Adapter Types and Registry

**Files:**
- Create: src/lib/adapters/types.ts
- Create: src/lib/adapters/types.test.ts

- [ ] Step 1: Write failing test for AdapterRegistry — create src/lib/adapters/types.test.ts with tests for register/get/has/listInstalled/replace
- [ ] Step 2: Run test to verify it fails (module not found)
- [ ] Step 3: Implement NpcAdapter interface, all supporting types (AdapterExecuteOptions, AdapterAttachment, AdapterSessionInfo, AdapterHealthResult, AdapterConfigField, AdapterConfigSchema), and AdapterRegistry class in src/lib/adapters/types.ts
- [ ] Step 4: Run test to verify all 5 tests pass
- [ ] Step 5: Commit — "feat(adapters): add NpcAdapter interface and AdapterRegistry"

---

### Task 2: OpenClawAdapter — Wrap Existing Gateway

**Files:**
- Create: src/lib/adapters/openclaw-adapter.ts
- Create: src/lib/adapters/openclaw-adapter.test.ts

- [ ] Step 1: Write failing test — verify type is "openclaw", executeWithGateway delegates to gateway.chatSend with streaming, abortWithGateway delegates to gateway.chatAbort
- [ ] Step 2: Run test to verify it fails (module not found)
- [ ] Step 3: Implement OpenClawAdapter with executeWithGateway(gateway, options) and abortWithGateway(gateway, agentId, sessionKey) methods. Standard execute() throws instructing caller to use executeWithGateway
- [ ] Step 4: Run test to verify all tests pass
- [ ] Step 5: Commit — "feat(adapters): add OpenClawAdapter wrapping existing gateway"

---

### Task 3: DB Schema — Add adapter_type and adapter_config to npcs

**Files:**
- Modify: src/db/schema.ts:217-231
- Modify: src/db/schema-sqlite.ts
- Modify: src/db/sqlite-base-schema.js
- Modify: src/db/server-db.js (ensureSqliteCompatibility)

- [ ] Step 1: Add adapterType VARCHAR(20) NOT NULL DEFAULT 'openclaw' and adapterConfig JSONB to npcs in PostgreSQL schema (schema.ts)
- [ ] Step 2: Add same columns to SQLite schema (schema-sqlite.ts, sqlite-base-schema.js)
- [ ] Step 3: Add ALTER TABLE migration in ensureSqliteCompatibility (server-db.js) with try/catch for existing columns
- [ ] Step 4: Run DB tests to verify no regressions
- [ ] Step 5: Commit — "schema: add adapter_type and adapter_config columns to npcs"

---

### Task 4: Extend NpcConfig and getNpcConfig

**Files:**
- Modify: src/server/socket-handlers.ts:85-94 (NpcConfig interface)
- Modify: src/server/socket-handlers.ts:515-570 (getNpcConfig, getNpcConfigsForChannel)

- [ ] Step 1: Add adapterType: string and adapterConfig: Record<string, unknown> to NpcConfig interface
- [ ] Step 2: Update getNpcConfig to read npc.adapterType and npc.adapterConfig from DB, defaulting adapterType to "openclaw"
- [ ] Step 3: Apply same changes to getNpcConfigsForChannel
- [ ] Step 4: TypeScript compilation check (npx tsc --noEmit)
- [ ] Step 5: Commit — "feat(adapters): extend NpcConfig with adapterType and adapterConfig"

---

### Task 5: Initialize Global Registry and Refactor streamNpcResponse

**Files:**
- Modify: src/server/socket-handlers.ts (top-level imports + streamNpcResponse + streamMeetingNpcResponse)

- [ ] Step 1: Import AdapterRegistry and OpenClawAdapter at top of socket-handlers.ts. Create global registry instance and register openclawAdapter
- [ ] Step 2: Refactor streamNpcResponse to check npcConfig.adapterType — for "openclaw", use openclawAdapter.executeWithGateway(gateway, options); for unknown types, emit "unsupported_adapter" system response
- [ ] Step 3: Apply same pattern to streamMeetingNpcResponse
- [ ] Step 4: Run meeting tests to verify no regressions
- [ ] Step 5: Commit — "refactor: route NPC responses through AdapterRegistry"

---

### Task 6: Refactor Nudge Flow Through Adapter

**Files:**
- Modify: src/server/socket-handlers.ts:347-415 (runProgressNudgeForTask)

- [ ] Step 1: Update runProgressNudgeForTask to check npcConfig.adapterType before calling gateway — for "openclaw", use openclawAdapter.executeWithGateway; for other types, return early (Phase 2 will handle)
- [ ] Step 2: Verify task tests pass
- [ ] Step 3: Commit — "refactor: route nudge flow through adapter"

---

### Task 7: MeetingBroker — Accept adapterResolver

**Files:**
- Modify: src/lib/meeting-broker.js
- Modify: src/server/meeting-discussion.ts
- Test: src/lib/meeting-broker.test.ts

- [ ] Step 1: Add test in meeting-broker.test.ts — MeetingBroker accepts adapterResolver in config
- [ ] Step 2: Update MeetingBroker constructor to store config.adapterResolver (optional, null by default). Gateway remains the active path in Phase 1
- [ ] Step 3: Update meeting-discussion.ts to pass adapterResolver when creating MeetingBroker (returns openclawAdapter for all NPCs for now)
- [ ] Step 4: Run all meeting tests to verify no regressions
- [ ] Step 5: Commit — "feat(meeting): wire adapterResolver into MeetingBroker for Phase 2"

---

### Task 8: Smoke Test and Final Verification

- [ ] Step 1: Run all test files (adapters, meeting, task, DB)
- [ ] Step 2: TypeScript compilation check
- [ ] Step 3: Start dev server and verify NPC chat still works through OpenClaw path
- [ ] Step 4: Final commit — "feat(adapters): Phase 1 complete — adapter abstraction layer"

---

## Phase Summary

After completing all 8 tasks:

**New files (4):**
- src/lib/adapters/types.ts — NpcAdapter interface + AdapterRegistry
- src/lib/adapters/types.test.ts — Registry tests
- src/lib/adapters/openclaw-adapter.ts — OpenClaw adapter
- src/lib/adapters/openclaw-adapter.test.ts — OpenClaw adapter tests

**Modified files (7):**
- src/db/schema.ts — npcs: +adapter_type, +adapter_config
- src/db/schema-sqlite.ts — same
- src/db/sqlite-base-schema.js — same
- src/db/server-db.js — SQLite migration
- src/server/socket-handlers.ts — NpcConfig extended, adapter routing
- src/server/meeting-discussion.ts — adapterResolver wiring
- src/lib/meeting-broker.js — adapterResolver config

**External behavior:** Zero changes. All NPC communication still goes through OpenClaw.

## Next Plans

- Phase 2: multi-adapter-phase2-cli-adapters — SubprocessPool, CliBaseAdapter, Claude/Codex/Gemini/OpenCode adapters, Provider resources and auth
- Phase 3: multi-adapter-phase3-dm-hub — DM Hub, cross-session context, improved nudge flow, npc_sessions table
- Phase 4: multi-adapter-phase4-ui-docker — Provider management UI, NpcHireModal extension, NpcDialog changes, Docker deployment
