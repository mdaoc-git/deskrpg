# Task Backlog & Kanban DnD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable users to create backlog tasks without NPC conversation, manage all tasks via a drag-and-drop kanban board with 5 columns, and auto-execute tasks when assigned to an NPC.

**Architecture:** Extend the existing task system by making `npcId` nullable (backlog = unassigned), adding a `backlog` status, implementing HTML5 native drag-and-drop on the TaskBoard, and adding a `task:move` socket event for state transitions with auto-execution triggers.

**Tech Stack:** Next.js 16, React 19, TypeScript, Drizzle ORM (PostgreSQL + SQLite), Socket.IO, HTML5 Drag and Drop API, Tailwind CSS

---

### Task 1: Schema — Make npcId nullable + add backlog status

**Files:**
- Modify: `src/db/schema.ts:278`
- Modify: `src/db/schema-sqlite.ts:278`
- Modify: `src/db/sqlite-base-schema.js:229`
- Modify: `src/db/server-db.js:155` (ensureSqliteCompatibility)
- Test: `src/lib/task-manager.test.ts`

- [ ] **Step 1: Write failing test for backlog task creation (npcId=null)**

Add a new test block at the end of `src/lib/task-manager.test.ts`. The test DB schema inside the test file also needs updating (npc_id NOT NULL → nullable).

```typescript
// Add to the test file — update the CREATE TABLE tasks in createTaskTestDb():
// Change: npc_id TEXT NOT NULL REFERENCES npcs(id) ON DELETE CASCADE
// To:     npc_id TEXT REFERENCES npcs(id) ON DELETE CASCADE

// Then add this test:
test("createBacklogTask: creates task with null npcId and backlog status", async () => {
  const { mgr } = createTaskTestDb();
  const task = await mgr.createBacklogTask("channel-1", "character-1", "Backlog task title", "Some description");
  assert.ok(task);
  assert.equal(task.status, "backlog");
  assert.equal(task.npcId, null);
  assert.equal(task.title, "Backlog task title");
  assert.equal(task.summary, "Some description");
  assert.equal(task.assignerId, "character-1");
  assert.equal(task.channelId, "channel-1");
  assert.ok(task.id);
  assert.ok(task.npcTaskId); // auto-generated
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/task-manager.test.ts 2>&1 | tail -20`
Expected: FAIL — `mgr.createBacklogTask is not a function`

- [ ] **Step 3: Update PostgreSQL schema — npcId nullable**

In `src/db/schema.ts:278`, change:

```typescript
// Before:
npcId: uuid("npc_id").notNull().references(() => npcs.id, { onDelete: "cascade" }),
// After:
npcId: uuid("npc_id").references(() => npcs.id, { onDelete: "cascade" }),
```

- [ ] **Step 4: Update SQLite schema — npcId nullable**

In `src/db/schema-sqlite.ts:278`, change:

```typescript
// Before:
npcId: text("npc_id").notNull().references(() => npcs.id, { onDelete: "cascade" }),
// After:
npcId: text("npc_id").references(() => npcs.id, { onDelete: "cascade" }),
```

- [ ] **Step 5: Update sqlite-base-schema.js — npcId nullable**

In `src/db/sqlite-base-schema.js:229`, change:

```javascript
// Before:
npc_id TEXT NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
// After:
npc_id TEXT REFERENCES npcs(id) ON DELETE CASCADE,
```

- [ ] **Step 6: Update ensureSqliteCompatibility in server-db.js**

Add a migration step for existing databases. In `src/db/server-db.js`, inside the `ensureSqliteCompatibility` function, add before the closing of the function:

```javascript
// SQLite doesn't support ALTER COLUMN, but the NOT NULL constraint
// is already relaxed for new DBs via schema change. For existing DBs,
// SQLite allows NULL inserts when foreign_keys pragma is OFF (default).
// No migration needed — the Drizzle schema change is sufficient.
```

No actual migration code needed — SQLite's FK enforcement is pragma-dependent and the schema files are already updated for fresh databases.

- [ ] **Step 7: Implement createBacklogTask in task-manager.js**

In `src/lib/task-manager.js`, add this method to the `TaskManager` class (after `completeTask`):

```javascript
async createBacklogTask(channelId, assignerId, title, summary) {
  const { db, schema } = this;
  const npcTaskId = `backlog-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const now = nowIso();

  const [row] = await db
    .insert(schema.tasks)
    .values({
      channelId,
      npcId: null,
      assignerId,
      npcTaskId,
      title,
      summary: summary || null,
      status: "backlog",
      autoNudgeCount: 0,
      autoNudgeMax: 5,
      lastNudgedAt: null,
      lastReportedAt: null,
      stalledAt: null,
      stalledReason: null,
      completedAt: null,
    })
    .returning();

  return normalizeTask(row);
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx tsx --test src/lib/task-manager.test.ts 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/db/schema.ts src/db/schema-sqlite.ts src/db/sqlite-base-schema.js src/db/server-db.js src/lib/task-manager.js src/lib/task-manager.test.ts
git commit -m "feat: make npcId nullable and add backlog task creation"
```

---

### Task 2: TaskManager — moveTask method with state transition logic

**Files:**
- Modify: `src/lib/task-manager.js`
- Test: `src/lib/task-manager.test.ts`

- [ ] **Step 1: Write failing tests for moveTask**

Add to `src/lib/task-manager.test.ts`:

```typescript
test("moveTask: backlog → pending with npcId", async () => {
  const { mgr } = createTaskTestDb();
  const task = await mgr.createBacklogTask("channel-1", "character-1", "Test task", null);
  const moved = await mgr.moveTask(task.id, "channel-1", "pending", "npc-1");
  assert.equal(moved.status, "pending");
  assert.equal(moved.npcId, "npc-1");
});

test("moveTask: pending → backlog clears npcId", async () => {
  const { mgr } = createTaskTestDb();
  const task = await mgr.createBacklogTask("channel-1", "character-1", "Test task", null);
  await mgr.moveTask(task.id, "channel-1", "pending", "npc-1");
  const moved = await mgr.moveTask(task.id, "channel-1", "backlog", null);
  assert.equal(moved.status, "backlog");
  assert.equal(moved.npcId, null);
});

test("moveTask: pending → in_progress", async () => {
  const { mgr } = createTaskTestDb();
  const task = await mgr.createBacklogTask("channel-1", "character-1", "Test task", null);
  await mgr.moveTask(task.id, "channel-1", "pending", "npc-1");
  const moved = await mgr.moveTask(task.id, "channel-1", "in_progress", null);
  assert.equal(moved.status, "in_progress");
  assert.equal(moved.npcId, "npc-1"); // keeps existing npcId
});

test("moveTask: any → complete sets completedAt", async () => {
  const { mgr } = createTaskTestDb();
  const task = await mgr.createBacklogTask("channel-1", "character-1", "Test task", null);
  await mgr.moveTask(task.id, "channel-1", "pending", "npc-1");
  const moved = await mgr.moveTask(task.id, "channel-1", "complete", null);
  assert.equal(moved.status, "complete");
  assert.ok(moved.completedAt);
});

test("moveTask: any → cancelled without npcId", async () => {
  const { mgr } = createTaskTestDb();
  const task = await mgr.createBacklogTask("channel-1", "character-1", "Test task", null);
  const moved = await mgr.moveTask(task.id, "channel-1", "cancelled", null);
  assert.equal(moved.status, "cancelled");
  assert.equal(moved.npcId, null);
});

test("moveTask: rejects non-backlog/cancelled without npcId when task has no npcId", async () => {
  const { mgr } = createTaskTestDb();
  const task = await mgr.createBacklogTask("channel-1", "character-1", "Test task", null);
  await assert.rejects(
    () => mgr.moveTask(task.id, "channel-1", "pending", null),
    { message: /npcId required/ },
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/lib/task-manager.test.ts 2>&1 | tail -20`
Expected: FAIL — `mgr.moveTask is not a function`

- [ ] **Step 3: Implement moveTask in task-manager.js**

Add to the `TaskManager` class in `src/lib/task-manager.js`:

```javascript
/**
 * Move a task to a new status. Handles npcId assignment/clearing.
 * Returns { task, fromStatus } for the caller to trigger actions.
 * @throws {Error} if npcId is required but not provided
 */
async moveTask(taskId, channelId, toStatus, npcId) {
  const { db, schema } = this;

  const current = await this.getTaskById(taskId, channelId);
  if (!current) return null;

  const fromStatus = current.status;

  // Determine final npcId
  let finalNpcId;
  if (toStatus === "backlog") {
    finalNpcId = null; // clear assignment
  } else if (toStatus === "cancelled") {
    finalNpcId = npcId || current.npcId || null; // keep or clear
  } else if (npcId) {
    finalNpcId = npcId; // explicitly provided
  } else if (current.npcId) {
    finalNpcId = current.npcId; // keep existing
  } else {
    throw new Error("npcId required for status: " + toStatus);
  }

  const now = nowIso();
  const completedAt = (toStatus === "complete" || toStatus === "cancelled") ? now : null;

  const updates = {
    status: toStatus,
    npcId: finalNpcId,
    updatedAt: now,
    completedAt,
  };

  // Reset nudge state when moving to in_progress
  if (toStatus === "in_progress") {
    updates.autoNudgeCount = 0;
    updates.lastNudgedAt = null;
    updates.stalledAt = null;
    updates.stalledReason = null;
  }

  // Reset nudge state when moving to backlog
  if (toStatus === "backlog") {
    updates.autoNudgeCount = 0;
    updates.lastNudgedAt = null;
    updates.stalledAt = null;
    updates.stalledReason = null;
  }

  const [row] = await db
    .update(schema.tasks)
    .set(updates)
    .where(
      and(
        eq(schema.tasks.id, taskId),
        eq(schema.tasks.channelId, channelId),
      ),
    )
    .returning();

  const task = normalizeTask(row);
  return { ...task, _fromStatus: fromStatus };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/task-manager.test.ts 2>&1 | tail -20`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/task-manager.js src/lib/task-manager.test.ts
git commit -m "feat: add moveTask method with state transition logic"
```

---

### Task 3: Socket handlers — task:create and task:move events

**Files:**
- Modify: `src/server/socket-handlers.ts:1247-1371` (add new handlers near existing task handlers)
- Modify: `src/lib/task-manager.js` (export createBacklogTask for NPC panel path)

- [ ] **Step 1: Add `task:create` socket handler**

In `src/server/socket-handlers.ts`, add after the `task:list` handler (after line ~1259):

```typescript
socket.on("task:create", async ({ channelId, title, summary, npcId }: {
  channelId: string; title: string; summary?: string; npcId?: string;
}) => {
  try {
    const player = players.get(socket.id);
    if (!player) return;
    if (!channelId || !title || typeof title !== "string") return;

    const trimmedTitle = title.trim().slice(0, 200);
    const trimmedSummary = summary?.trim() || null;
    if (!trimmedTitle) return;

    let task;
    if (npcId) {
      // Create as pending (assigned to NPC, not yet running)
      task = await taskManager.createBacklogTask(channelId, player.characterId, trimmedTitle, trimmedSummary);
      if (task) {
        const moved = await taskManager.moveTask(task.id, channelId, "pending", npcId);
        task = moved || task;
      }
    } else {
      // Create as backlog (unassigned)
      task = await taskManager.createBacklogTask(channelId, player.characterId, trimmedTitle, trimmedSummary);
    }

    if (task) {
      io.to(player.mapId).emit("task:updated", { task, action: "create" });
    }
  } catch (err) {
    console.error("[TaskManager] Error creating task:", err);
  }
});
```

- [ ] **Step 2: Add `task:move` socket handler**

In `src/server/socket-handlers.ts`, add after the `task:create` handler:

```typescript
socket.on("task:move", async ({ taskId, toStatus, npcId }: {
  taskId: string; toStatus: string; npcId?: string;
}) => {
  try {
    const player = players.get(socket.id);
    if (!player || !taskId || !toStatus) return;

    const validStatuses = ["backlog", "pending", "in_progress", "stalled", "complete", "cancelled"];
    if (!validStatuses.includes(toStatus)) return;

    const result = await taskManager.moveTask(taskId, player.mapId, toStatus, npcId || null);
    if (!result) return;

    const fromStatus = result._fromStatus;
    const task = { ...result };
    delete task._fromStatus;

    io.to(player.mapId).emit("task:updated", { task, action: `move_${fromStatus}_${toStatus}` });

    // Auto-execution trigger: → in_progress from backlog/pending
    const shouldAutoExecute = toStatus === "in_progress"
      && (fromStatus === "backlog" || fromStatus === "pending")
      && task.npcId;

    if (shouldAutoExecute) {
      const npcConfig = await getNpcConfig(task.npcId);
      if (npcConfig) {
        const locale = getSocketLocale(socket);
        const taskSessionPrompt = buildTaskSessionPrompt(task, locale);
        const autoStartMessage = taskSessionPrompt + "\n\n"
          + withTaskReminder(
              `[SYSTEM] New task assigned: "${task.title}". ${task.summary || ""} Begin working on this task now.`,
              locale,
            );

        const sessionKey = `${npcConfig.sessionKeyPrefix || task.npcId}-task-${task.npcTaskId}`;

        const response = await streamNpcResponse(
          socket, task.npcId, npcConfig, player.userId,
          autoStartMessage, undefined, sessionKey, "npc:task-response",
        );

        if (response) {
          const parsed = parseNpcResponse(response);
          await processNpcTaskActions(io, parsed, {
            channelId: task.channelId,
            npcId: task.npcId,
            npcName: npcConfig._name,
            assignerCharacterId: player.characterId,
            targetUserId: player.userId,
          });
          socket.emit("npc:response-complete", { npcId: task.npcId, npcName: npcConfig._name || task.npcId });
        }
      }
    }
  } catch (err) {
    console.error("[TaskManager] Error moving task:", err);
    if (err instanceof Error && err.message.includes("npcId required")) {
      socket.emit("task:move-error", { taskId, error: "npcId_required" });
    }
  }
});
```

- [ ] **Step 3: Verify `buildTaskSessionPrompt` and `withTaskReminder` imports exist**

Check that these imports are already present at the top of `socket-handlers.ts`. They should be since the `npc:task-chat` handler uses them. Verify with:

Run: `grep -n "buildTaskSessionPrompt\|withTaskReminder" src/server/socket-handlers.ts | head -5`

- [ ] **Step 4: Commit**

```bash
git add src/server/socket-handlers.ts
git commit -m "feat: add task:create and task:move socket handlers with auto-execution"
```

---

### Task 4: i18n — Add new translation keys

**Files:**
- Modify: `src/lib/i18n/locales/en.ts`
- Modify: `src/lib/i18n/locales/ko.ts`
- Modify: `src/lib/i18n/locales/ja.ts`
- Modify: `src/lib/i18n/locales/zh.ts`

- [ ] **Step 1: Add English translations**

In `src/lib/i18n/locales/en.ts`, find the existing `task.` keys and add after them:

```typescript
"task.backlog": "Backlog",
"task.createNew": "New Task",
"task.assign": "Assign",
"task.assignToNpc": "Assign to NPC",
"task.selectNpc": "Select NPC",
"task.selectNpcDescription": "Select an NPC to execute \"{title}\"",
"task.unassigned": "Unassigned",
"task.autoStarted": "{npcName} started working on \"{title}\"",
"task.addToNpc": "Add Task to This NPC",
"task.npcWorkload": "{inProgress} in progress · {pending} pending",
"task.npcActive": "Active",
"task.npcInactive": "Inactive",
"task.titlePlaceholder": "Task title",
"task.summaryPlaceholder": "Description (optional)",
"task.dragHint": "Drag cards between columns · Click to view details",
```

- [ ] **Step 2: Add Korean translations**

In `src/lib/i18n/locales/ko.ts`, add:

```typescript
"task.backlog": "백로그",
"task.createNew": "새 태스크",
"task.assign": "할당",
"task.assignToNpc": "NPC에 할당",
"task.selectNpc": "NPC 선택",
"task.selectNpcDescription": "\"{title}\" 태스크를 실행할 NPC를 선택하세요",
"task.unassigned": "미할당",
"task.autoStarted": "{npcName}이(가) \"{title}\" 태스크를 시작했습니다",
"task.addToNpc": "이 NPC에 태스크 추가",
"task.npcWorkload": "진행 중 {inProgress} · 대기 {pending}",
"task.npcActive": "활성",
"task.npcInactive": "비활성",
"task.titlePlaceholder": "태스크 제목",
"task.summaryPlaceholder": "설명 (선택사항)",
"task.dragHint": "카드를 드래그하여 컬럼 간 이동 · 클릭하여 상세 보기",
```

- [ ] **Step 3: Add Japanese translations**

In `src/lib/i18n/locales/ja.ts`, add:

```typescript
"task.backlog": "バックログ",
"task.createNew": "新しいタスク",
"task.assign": "割り当て",
"task.assignToNpc": "NPCに割り当て",
"task.selectNpc": "NPC選択",
"task.selectNpcDescription": "「{title}」タスクを実行するNPCを選択してください",
"task.unassigned": "未割当",
"task.autoStarted": "{npcName}が「{title}」タスクを開始しました",
"task.addToNpc": "このNPCにタスクを追加",
"task.npcWorkload": "進行中 {inProgress} · 待機 {pending}",
"task.npcActive": "アクティブ",
"task.npcInactive": "非アクティブ",
"task.titlePlaceholder": "タスクタイトル",
"task.summaryPlaceholder": "説明（任意）",
"task.dragHint": "カードをドラッグして列間を移動 · クリックで詳細表示",
```

- [ ] **Step 4: Add Chinese translations**

In `src/lib/i18n/locales/zh.ts`, add:

```typescript
"task.backlog": "待办",
"task.createNew": "新任务",
"task.assign": "分配",
"task.assignToNpc": "分配给NPC",
"task.selectNpc": "选择NPC",
"task.selectNpcDescription": "选择执行\"{title}\"任务的NPC",
"task.unassigned": "未分配",
"task.autoStarted": "{npcName}已开始处理\"{title}\"任务",
"task.addToNpc": "添加任务到此NPC",
"task.npcWorkload": "进行中 {inProgress} · 待处理 {pending}",
"task.npcActive": "活跃",
"task.npcInactive": "非活跃",
"task.titlePlaceholder": "任务标题",
"task.summaryPlaceholder": "描述（可选）",
"task.dragHint": "拖拽卡片在列间移动 · 点击查看详情",
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n/locales/en.ts src/lib/i18n/locales/ko.ts src/lib/i18n/locales/ja.ts src/lib/i18n/locales/zh.ts
git commit -m "feat: add i18n keys for task backlog and kanban DnD"
```

---

### Task 5: TaskCard — Add backlog status config + assign button

**Files:**
- Modify: `src/components/TaskCard.tsx`

- [ ] **Step 1: Add backlog to STATUS_CONFIG and onAssign callback**

In `src/components/TaskCard.tsx`, add the `backlog` entry to `STATUS_CONFIG` and a new `onAssign` prop:

Add to imports at line 4:
```typescript
import { Clock, Circle, Check, X as XIcon, Bot, PauseCircle, Inbox } from "lucide-react";
```

Add to `Task` interface (line 8):
```typescript
// no change — status is already `string`, so "backlog" is accepted
```

Add to `TaskCardProps` interface:
```typescript
onAssign?: (taskId: string) => void;
```

Add to `STATUS_CONFIG` (before the `pending` entry):
```typescript
backlog: { labelKey: "task.backlog", color: "text-text-muted", border: "border-l-text-dim", icon: <Inbox className="w-3 h-3 inline" /> },
```

Add assign button in the action buttons section (after the resume button block, before the closing `</div>` of the action buttons):
```tsx
{task.status === "backlog" && onAssign ? (
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); onAssign(task.id); }}
    className="rounded bg-primary/20 px-2 py-1 text-[10px] text-primary hover:bg-primary/30"
  >
    {t("task.assign")}
  </button>
) : null}
```

Update `isFinished` check to exclude backlog from nudge display:
```typescript
// In the nudgeLabel computation, add backlog check:
const nudgeLabel = task.status === "stalled"
  ? t("task.stalledCount", { count: nudgeCount, max: nudgeMax })
  : (task.status === "pending" || task.status === "in_progress")
    ? t("task.autoNudgeCount", { count: nudgeCount, max: nudgeMax })
    : "";
// (no change needed — backlog already falls through to empty string)
```

Show "미할당" for backlog cards when showNpcName is true:
```tsx
// Replace the existing showNpcName block:
{showNpcName && (
  npcName ? (
    <Badge variant="npc" size="sm">
      <Bot className="w-3 h-3" />{npcName}
    </Badge>
  ) : (
    <span className="text-[9px] text-text-dim">{t("task.unassigned")}</span>
  )
)}
```

- [ ] **Step 2: Update the onAssign prop in the destructured props**

```typescript
export default function TaskCard({
  task,
  showNpcName = false,
  compact = false,
  onDelete,
  onRequestReport,
  onResume,
  onComplete,
  onAssign,
}: TaskCardProps) {
```

- [ ] **Step 3: Commit**

```bash
git add src/components/TaskCard.tsx
git commit -m "feat: add backlog status and assign button to TaskCard"
```

---

### Task 6: TaskCreateForm component

**Files:**
- Create: `src/components/TaskCreateForm.tsx`

- [ ] **Step 1: Create TaskCreateForm**

```tsx
"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n";
import { Plus, X } from "lucide-react";

interface TaskCreateFormProps {
  onSubmit: (title: string, summary: string) => void;
  onCancel: () => void;
}

export default function TaskCreateForm({ onSubmit, onCancel }: TaskCreateFormProps) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");

  const handleSubmit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    onSubmit(trimmed, summary.trim());
    setTitle("");
    setSummary("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <div className="bg-surface-raised rounded-lg p-2.5 border border-border">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t("task.titlePlaceholder")}
        maxLength={200}
        className="w-full bg-surface text-text text-caption rounded px-2 py-1.5 border border-border focus:outline-none focus:border-primary mb-1.5"
        autoFocus
      />
      <textarea
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t("task.summaryPlaceholder")}
        rows={2}
        className="w-full bg-surface text-text text-[10px] rounded px-2 py-1.5 border border-border focus:outline-none focus:border-primary resize-none mb-1.5"
      />
      <div className="flex gap-1.5 justify-end">
        <button
          onClick={onCancel}
          className="px-2 py-1 text-[10px] text-text-muted hover:text-text rounded"
        >
          <X className="w-3 h-3 inline" />
        </button>
        <button
          onClick={handleSubmit}
          disabled={!title.trim()}
          className="px-2.5 py-1 text-[10px] bg-primary text-white rounded hover:bg-primary/80 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />
          {t("task.createNew")}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/TaskCreateForm.tsx
git commit -m "feat: add TaskCreateForm component"
```

---

### Task 7: NpcAssignModal component

**Files:**
- Create: `src/components/NpcAssignModal.tsx`

- [ ] **Step 1: Create NpcAssignModal**

```tsx
"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n";
import { Bot, X } from "lucide-react";

interface NpcOption {
  id: string;
  name: string;
  inProgressCount: number;
  pendingCount: number;
  isActive: boolean;
}

interface NpcAssignModalProps {
  taskTitle: string;
  npcs: NpcOption[];
  onAssign: (npcId: string) => void;
  onCancel: () => void;
}

export default function NpcAssignModal({ taskTitle, npcs, onAssign, onCancel }: NpcAssignModalProps) {
  const t = useT();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div
        className="bg-surface-raised rounded-xl border border-border w-[340px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex justify-between items-center">
          <span className="text-title text-text">{t("task.selectNpc")}</span>
          <button onClick={onCancel} className="text-text-muted hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Description */}
        <div className="px-4 py-2 text-caption text-text-muted">
          {t("task.selectNpcDescription", { title: taskTitle })}
        </div>

        {/* NPC List */}
        <div className="flex-1 overflow-y-auto px-4 pb-2 space-y-1.5">
          {npcs.map((npc) => (
            <button
              key={npc.id}
              onClick={() => npc.isActive && setSelectedId(npc.id)}
              disabled={!npc.isActive}
              className={`w-full flex items-center gap-2.5 p-2.5 rounded-lg transition ${
                !npc.isActive
                  ? "opacity-40 cursor-not-allowed bg-surface"
                  : selectedId === npc.id
                    ? "bg-surface border-2 border-primary"
                    : "bg-surface hover:bg-surface-raised border-2 border-transparent"
              }`}
            >
              <div className="w-8 h-8 bg-primary/30 rounded-full flex items-center justify-center">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 text-left">
                <div className="text-caption font-bold text-text">{npc.name}</div>
                <div className="text-[10px] text-text-muted">
                  {t("task.npcWorkload", { inProgress: npc.inProgressCount, pending: npc.pendingCount })}
                </div>
              </div>
              <div className={`text-[10px] ${npc.isActive ? "text-success" : "text-danger"}`}>
                ● {npc.isActive ? t("task.npcActive") : t("task.npcInactive")}
              </div>
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="px-4 py-3 border-t border-border flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 px-3 py-2 text-caption bg-surface text-text-muted rounded-lg hover:bg-surface-raised"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={() => selectedId && onAssign(selectedId)}
            disabled={!selectedId}
            className="flex-1 px-3 py-2 text-caption bg-primary text-white rounded-lg hover:bg-primary/80 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("task.assign")}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/NpcAssignModal.tsx
git commit -m "feat: add NpcAssignModal component"
```

---

### Task 8: DroppableColumn and DraggableTaskCard components

**Files:**
- Create: `src/components/DroppableColumn.tsx`
- Create: `src/components/DraggableTaskCard.tsx`

- [ ] **Step 1: Create DroppableColumn**

```tsx
"use client";

import { useState, type ReactNode } from "react";

interface DroppableColumnProps {
  status: string;
  onDrop: (taskId: string, fromStatus: string, toStatus: string) => void;
  children: ReactNode;
  header: ReactNode;
  className?: string;
}

export default function DroppableColumn({ status, onDrop, children, header, className = "" }: DroppableColumnProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const taskId = e.dataTransfer.getData("text/task-id");
    const fromStatus = e.dataTransfer.getData("text/from-status");
    if (!taskId || fromStatus === status) return;

    onDrop(taskId, fromStatus, status);
  };

  return (
    <div
      className={`flex-1 bg-surface rounded-lg p-2.5 flex flex-col transition-all ${
        isDragOver ? "ring-2 ring-primary/60 bg-primary/5" : ""
      } ${className}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {header}
      <div className="flex-1 overflow-y-auto space-y-2">
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create DraggableTaskCard**

```tsx
"use client";

import { useState, type ReactNode } from "react";

interface DraggableTaskCardProps {
  taskId: string;
  status: string;
  children: ReactNode;
}

export default function DraggableTaskCard({ taskId, status, children }: DraggableTaskCardProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/task-id", taskId);
    e.dataTransfer.setData("text/from-status", status);
    e.dataTransfer.effectAllowed = "move";
    setIsDragging(true);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={`cursor-grab active:cursor-grabbing transition-opacity ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/DroppableColumn.tsx src/components/DraggableTaskCard.tsx
git commit -m "feat: add DroppableColumn and DraggableTaskCard components"
```

---

### Task 9: TaskBoard — 5-column kanban with DnD + NPC modal integration

**Files:**
- Modify: `src/components/TaskBoard.tsx` (full rewrite of the column section)

- [ ] **Step 1: Rewrite TaskBoard with 5 columns and DnD**

Replace the entire content of `src/components/TaskBoard.tsx` with:

```tsx
"use client";

import { useState, useMemo, useCallback } from "react";
import TaskCard from "./TaskCard";
import type { Task } from "./TaskCard";
import TaskCreateForm from "./TaskCreateForm";
import NpcAssignModal from "./NpcAssignModal";
import DroppableColumn from "./DroppableColumn";
import DraggableTaskCard from "./DraggableTaskCard";
import { useT } from "@/lib/i18n";
import { ClipboardList, X, Clock, Loader, CheckCircle, PauseCircle, Inbox } from "lucide-react";
import type { Socket } from "socket.io-client";

interface NpcInfo {
  id: string;
  name: string;
  isActive: boolean;
}

interface TaskBoardProps {
  channelId: string;
  isOpen: boolean;
  onClose: () => void;
  onDeleteTask?: (taskId: string) => void;
  onRequestReportTask?: (taskId: string) => void;
  onResumeTask?: (taskId: string) => void;
  onCompleteTask?: (taskId: string) => void;
  tasks: Task[];
  socket: Socket | null;
  npcs?: NpcInfo[];
}

const COLUMNS = [
  { status: "backlog", labelKey: "task.backlog", colorClass: "text-text-muted", bgClass: "bg-text-muted/20", Icon: Inbox },
  { status: "pending", labelKey: "task.pending", colorClass: "text-npc", bgClass: "bg-npc/20", Icon: Clock },
  { status: "in_progress", labelKey: "task.inProgress", colorClass: "text-danger", bgClass: "bg-danger/20", Icon: Loader },
  { status: "stalled", labelKey: "task.stalled", colorClass: "text-warning", bgClass: "bg-warning/20", Icon: PauseCircle },
  { status: "done", labelKey: "task.done", colorClass: "text-success", bgClass: "bg-success/20", Icon: CheckCircle },
] as const;

export default function TaskBoard({
  channelId,
  isOpen,
  onClose,
  tasks,
  onDeleteTask,
  onRequestReportTask,
  onResumeTask,
  onCompleteTask,
  socket,
  npcs = [],
}: TaskBoardProps) {
  const t = useT();
  const [filterNpc, setFilterNpc] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [assignModal, setAssignModal] = useState<{
    taskId: string;
    taskTitle: string;
    toStatus: string;
  } | null>(null);

  const npcList = useMemo(() => {
    const map = new Map<string, string>();
    tasks.forEach((task) => {
      if (task.npcId && task.npcName && !map.has(task.npcId)) {
        map.set(task.npcId, task.npcName);
      }
    });
    return Array.from(map.entries());
  }, [tasks]);

  const filtered = filterNpc ? tasks.filter((t) => t.npcId === filterNpc) : tasks;

  const groupedTasks = useMemo(() => ({
    backlog: filtered.filter((t) => t.status === "backlog"),
    pending: filtered.filter((t) => t.status === "pending"),
    in_progress: filtered.filter((t) => t.status === "in_progress"),
    stalled: filtered.filter((t) => t.status === "stalled"),
    done: filtered.filter((t) => t.status === "complete" || t.status === "cancelled"),
  }), [filtered]);

  // Build NPC options for the assign modal
  const npcOptions = useMemo(() => {
    return npcs.map((npc) => ({
      id: npc.id,
      name: npc.name,
      inProgressCount: tasks.filter((t) => t.npcId === npc.id && t.status === "in_progress").length,
      pendingCount: tasks.filter((t) => t.npcId === npc.id && t.status === "pending").length,
      isActive: npc.isActive,
    }));
  }, [npcs, tasks]);

  const handleCreateTask = useCallback((title: string, summary: string) => {
    if (!socket) return;
    socket.emit("task:create", { channelId, title, summary: summary || undefined });
    setShowCreateForm(false);
  }, [socket, channelId]);

  const handleDrop = useCallback((taskId: string, fromStatus: string, toStatus: string) => {
    if (!socket) return;

    // Map "done" column back to "complete"
    const actualToStatus = toStatus === "done" ? "complete" : toStatus;
    const actualFromStatus = fromStatus === "done" ? "complete" : fromStatus;
    if (actualFromStatus === actualToStatus) return;

    // Find the task
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    // Check if NPC modal is needed
    const needsNpc = !task.npcId && actualToStatus !== "backlog" && actualToStatus !== "cancelled";
    if (needsNpc) {
      setAssignModal({ taskId, taskTitle: task.title, toStatus: actualToStatus });
      return;
    }

    socket.emit("task:move", { taskId, toStatus: actualToStatus });
  }, [socket, tasks]);

  const handleAssignFromModal = useCallback((npcId: string) => {
    if (!socket || !assignModal) return;
    socket.emit("task:move", { taskId: assignModal.taskId, toStatus: assignModal.toStatus, npcId });
    setAssignModal(null);
  }, [socket, assignModal]);

  const handleAssignClick = useCallback((taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    setAssignModal({ taskId, taskTitle: task.title, toStatus: "pending" });
  }, [tasks]);

  if (!isOpen) return null;

  return (
    <div className="theme-game fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-surface-raised rounded-xl border border-border w-[95vw] max-w-[1100px] h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex justify-between items-center">
          <div className="flex items-center gap-3">
            <span className="text-title text-text flex items-center gap-1.5">
              <ClipboardList className="w-4 h-4" />{t("task.board")}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setFilterNpc(null)}
                className={`px-2 py-0.5 rounded text-[10px] ${
                  !filterNpc ? "bg-primary text-white" : "bg-surface text-text-muted"
                }`}
              >
                {t("common.all")}
              </button>
              {npcList.map(([id, name]) => (
                <button
                  key={id}
                  onClick={() => setFilterNpc(id)}
                  className={`px-2 py-0.5 rounded text-[10px] ${
                    filterNpc === id ? "bg-primary text-white" : "bg-surface text-text-muted"
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        {/* Kanban Columns */}
        <div className="flex-1 flex gap-2 p-3 overflow-hidden">
          {COLUMNS.map((col) => {
            const colTasks = groupedTasks[col.status as keyof typeof groupedTasks] || [];
            return (
              <DroppableColumn
                key={col.status}
                status={col.status}
                onDrop={handleDrop}
                header={
                  <div className={`text-[11px] ${col.colorClass} font-bold mb-2 flex justify-between`}>
                    <span className="flex items-center gap-1">
                      <col.Icon className="w-3.5 h-3.5" />{t(col.labelKey)}
                    </span>
                    <span className={`${col.bgClass} px-1.5 rounded`}>{colTasks.length}</span>
                  </div>
                }
              >
                {col.status === "backlog" && (
                  showCreateForm ? (
                    <TaskCreateForm
                      onSubmit={handleCreateTask}
                      onCancel={() => setShowCreateForm(false)}
                    />
                  ) : (
                    <button
                      onClick={() => setShowCreateForm(true)}
                      className="w-full border border-dashed border-primary/50 rounded-lg py-2 text-[11px] text-primary hover:border-primary hover:bg-primary/5 transition mb-1"
                    >
                      + {t("task.createNew")}
                    </button>
                  )
                )}
                {colTasks.map((task) => (
                  <DraggableTaskCard key={task.id} taskId={task.id} status={col.status}>
                    <TaskCard
                      task={task}
                      showNpcName
                      compact
                      onDelete={onDeleteTask}
                      onRequestReport={onRequestReportTask}
                      onResume={onResumeTask}
                      onComplete={onCompleteTask}
                      onAssign={handleAssignClick}
                    />
                  </DraggableTaskCard>
                ))}
              </DroppableColumn>
            );
          })}
        </div>

        {/* Drag hint */}
        <div className="px-4 py-2 text-center text-[10px] text-text-dim border-t border-border">
          {t("task.dragHint")}
        </div>
      </div>

      {/* NPC Assign Modal */}
      {assignModal && (
        <NpcAssignModal
          taskTitle={assignModal.taskTitle}
          npcs={npcOptions}
          onAssign={handleAssignFromModal}
          onCancel={() => setAssignModal(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/TaskBoard.tsx
git commit -m "feat: rewrite TaskBoard with 5-column kanban DnD and NPC modal"
```

---

### Task 10: TaskPanel — Add "create task for this NPC" button

**Files:**
- Modify: `src/components/TaskPanel.tsx`

- [ ] **Step 1: Add create button and form to TaskPanel**

In `src/components/TaskPanel.tsx`, add the import and state:

```typescript
// Add import at top:
import TaskCreateForm from "./TaskCreateForm";

// Add state inside the component:
const [showCreateForm, setShowCreateForm] = useState(false);
```

Add the create task handler:

```typescript
const handleCreateForNpc = (title: string, summary: string) => {
  if (!socket) return;
  socket.emit("task:create", { channelId: null, title, summary: summary || undefined, npcId });
  setShowCreateForm(false);
};
```

Note: `channelId: null` — the server will need the channelId. We need to pass it from the NPC config. Add `channelId` to props:

Update the props interface:
```typescript
interface TaskPanelProps {
  npcId: string;
  npcName: string;
  channelId: string; // NEW
  socket: Socket | null;
  // ... rest unchanged
}
```

Update the handler:
```typescript
const handleCreateForNpc = (title: string, summary: string) => {
  if (!socket) return;
  socket.emit("task:create", { channelId, title, summary: summary || undefined, npcId });
  setShowCreateForm(false);
};
```

Add the UI before the task list sections, after the loading check:

```tsx
// After line 127 (the loading check), before the tasks.length === 0 check:
// Add the create button section
```

Replace the `tasks.length === 0` block and the return at the end:

```tsx
return (
  <div className="flex-1 overflow-y-auto p-2 space-y-2">
    {/* Add Task button */}
    <div className="mb-2">
      {showCreateForm ? (
        <TaskCreateForm
          onSubmit={handleCreateForNpc}
          onCancel={() => setShowCreateForm(false)}
        />
      ) : (
        <button
          onClick={() => setShowCreateForm(true)}
          className="w-full border border-dashed border-primary/50 rounded-lg py-1.5 text-[10px] text-primary hover:border-primary hover:bg-primary/5 transition"
        >
          + {t("task.addToNpc")}
        </button>
      )}
    </div>

    {tasks.length === 0 && !showCreateForm && (
      <div className="flex items-center justify-center text-text-muted text-body py-8">
        {t("task.noTasks", { name: npcName })}
      </div>
    )}

    {activeTasks.length > 0 && (
      <>
        <div className="text-micro text-text-dim font-bold px-1">{t("task.active")} ({activeTasks.length})</div>
        {activeTasks.map((task) => (
          <div
            key={task.id}
            onClick={() => onTaskClick?.(task.npcTaskId || task.id)}
            className={onTaskClick ? "cursor-pointer hover:brightness-110 transition" : ""}
          >
            <TaskCard task={task} onDelete={handleDelete} onRequestReport={handleRequestReport} onResume={handleResume} onComplete={handleComplete} />
          </div>
        ))}
      </>
    )}
    {stalledTasks.length > 0 && (
      <>
        <div className="text-micro text-text-dim font-bold px-1 mt-2">{t("task.stalled")} ({stalledTasks.length})</div>
        {stalledTasks.map((task) => (
          <div
            key={task.id}
            onClick={() => onTaskClick?.(task.npcTaskId || task.id)}
            className={onTaskClick ? "cursor-pointer hover:brightness-110 transition" : ""}
          >
            <TaskCard task={task} onDelete={handleDelete} onRequestReport={handleRequestReport} onResume={handleResume} onComplete={handleComplete} />
          </div>
        ))}
      </>
    )}
    {doneTasks.length > 0 && (
      <>
        <div className="text-micro text-text-dim font-bold px-1 mt-2">{t("task.done")} ({doneTasks.length})</div>
        {doneTasks.map((task) => (
          <div
            key={task.id}
            onClick={() => onTaskClick?.(task.npcTaskId || task.id)}
            className={onTaskClick ? "cursor-pointer hover:brightness-110 transition" : ""}
          >
            <TaskCard task={task} onDelete={handleDelete} onRequestReport={handleRequestReport} onResume={handleResume} onComplete={handleComplete} />
          </div>
        ))}
      </>
    )}
  </div>
);
```

- [ ] **Step 2: Update TaskPanel callers to pass channelId**

Search for `<TaskPanel` usages and add the `channelId` prop. The primary caller is in `GamePageClient.tsx` or `NpcDialog.tsx`. Find and update:

Run: `grep -rn "<TaskPanel" src/`

Add `channelId={channelId}` to each `<TaskPanel` usage.

- [ ] **Step 3: Commit**

```bash
git add src/components/TaskPanel.tsx
git commit -m "feat: add create task button to TaskPanel for NPC-direct assignment"
```

---

### Task 11: Wire TaskBoard into GamePageClient — pass npcs and socket

**Files:**
- Modify: `src/app/game/GamePageClient.tsx` (find TaskBoard usage and add new props)

- [ ] **Step 1: Update TaskBoard props in GamePageClient**

Find where `<TaskBoard` is rendered in `GamePageClient.tsx`. Add:

```tsx
<TaskBoard
  channelId={channelId}
  isOpen={taskBoardOpen}
  onClose={() => setTaskBoardOpen(false)}
  tasks={allTasks}
  onDeleteTask={handleDeleteTask}
  onRequestReportTask={handleRequestReport}
  onResumeTask={handleResumeTask}
  onCompleteTask={handleCompleteTask}
  socket={socketRef.current}
  npcs={channelNpcs.map((npc) => ({
    id: npc.id,
    name: npc.name,
    isActive: Boolean(npc.openclawConfig),
  }))}
/>
```

The exact prop names for NPC list and socket depend on what's available in scope. Find `channelNpcs` or equivalent NPC array variable in the component.

Run: `grep -n "channelNpcs\|npcList\|npcs.*useState" src/app/game/GamePageClient.tsx | head -10`

Adjust the `npcs` mapping based on the actual variable and its shape.

- [ ] **Step 2: Add toast notification for auto-started tasks**

In the socket event handler section of `GamePageClient.tsx`, add a listener for task auto-start:

```typescript
// In the socket event setup useEffect:
socket.on("task:updated", ({ task, action }: { task: Task; action: string }) => {
  // existing handler logic ...

  // Add auto-start toast
  if (action.startsWith("move_") && action.endsWith("_in_progress")) {
    const npcName = task.npcName || "";
    if (npcName && task.title) {
      showToast(t("task.autoStarted", { npcName, title: task.title }));
    }
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add src/app/game/GamePageClient.tsx
git commit -m "feat: wire TaskBoard with socket, npcs, and auto-start toast"
```

---

### Task 12: POST /api/tasks endpoint

**Files:**
- Modify: `src/app/api/tasks/route.ts`

- [ ] **Step 1: Add POST handler**

In `src/app/api/tasks/route.ts`, add after the GET function:

```typescript
export async function POST(req: NextRequest) {
  const userId = req.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ errorCode: "unauthorized", error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { channelId, title, summary } = body;

    if (!channelId || !title || typeof title !== "string") {
      return NextResponse.json({ errorCode: "bad_request", error: "channelId and title required" }, { status: 400 });
    }

    const trimmedTitle = title.trim().slice(0, 200);
    if (!trimmedTitle) {
      return NextResponse.json({ errorCode: "bad_request", error: "title cannot be empty" }, { status: 400 });
    }

    // Find user's character for assignerId
    const { characters } = await import("@/db");
    const [character] = await db
      .select({ id: characters.id })
      .from(characters)
      .where(eq(characters.userId, userId))
      .limit(1);

    if (!character) {
      return NextResponse.json({ errorCode: "character_not_found", error: "No character found" }, { status: 404 });
    }

    const npcTaskId = `backlog-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    const [task] = await db
      .insert(tasks)
      .values({
        channelId,
        npcId: null,
        assignerId: character.id,
        npcTaskId,
        title: trimmedTitle,
        summary: summary?.trim() || null,
        status: "backlog",
      })
      .returning();

    return NextResponse.json(task, { status: 201 });
  } catch (err) {
    console.error("[Tasks API] Error creating task:", err);
    return NextResponse.json({ errorCode: "internal_server_error", error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Add `characters` import if not already present**

Check the import line at the top. Update:

```typescript
import { db } from "@/db";
import { tasks, npcs, characters } from "@/db";
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/tasks/route.ts
git commit -m "feat: add POST /api/tasks endpoint for backlog creation"
```

---

### Task 13: Integration testing — full flow verification

**Files:**
- Test: `src/lib/task-manager.test.ts` (run existing + new tests)
- Manual: verify build compiles

- [ ] **Step 1: Run all task manager tests**

Run: `npx tsx --test src/lib/task-manager.test.ts`
Expected: All tests PASS

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No errors (or only pre-existing ones)

- [ ] **Step 3: Verify build succeeds**

Run: `npm run build 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: resolve build issues from task backlog feature"
```
