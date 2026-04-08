# Task Session Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NPC 대화 세션과 태스크 세션을 분리하여, 여러 태스크를 독립된 OpenClaw 세션에서 관리하고, 기존 대화 UX를 유지하면서 태스크별 전용 대화를 제공한다.

**Architecture:** `streamNpcResponse`에 커스텀 세션 키를 받는 파라미터 추가. 태스크 세션에서는 `npc-{npcId}-task-{taskId}` 키를 사용. NpcDialog에 `activeTaskId` 상태를 추가하여 태스크 전용 대화 뷰를 렌더링. 태스크 생성 시 DM에 인라인 태스크 카드를 삽입하고, 완료 시 NPC가 걸어와서 DM에 보고.

**Tech Stack:** Next.js 16, React 19, Socket.io, OpenClaw WebSocket RPC, TypeScript

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/lib/task-prompt.js` | `buildTaskSessionPrompt()` 함수 추가 |
| Modify | `src/server/socket-handlers.ts` | `npc:task-chat` 핸들러 + `streamNpcResponse` 세션 키 파라미터화 |
| Create | `src/components/TaskInlineCard.tsx` | DM 채팅 내 인라인 태스크 카드 |
| Create | `src/components/TaskChatView.tsx` | 태스크 전용 대화 뷰 (메시지 목록 + ChatInput) |
| Modify | `src/components/NpcDialog.tsx` | `activeTaskId` 상태 + 3단계 네비게이션 |
| Modify | `src/components/TaskPanel.tsx` | `onTaskClick` 콜백 추가 |
| Modify | `src/app/game/GamePageClient.tsx` | 태스크 메시지 상태 + 소켓 이벤트 연결 |

---

### Task 1: buildTaskSessionPrompt 구현

**Files:**
- Modify: `src/lib/task-prompt.js`
- Modify: `src/lib/task-prompt.test.ts`

- [ ] **Step 1: 테스트 작성**

`src/lib/task-prompt.test.ts` 끝에 추가:

```javascript
test("buildTaskSessionPrompt includes task context", () => {
  const { buildTaskSessionPrompt } = require("./task-prompt.js");
  const task = { title: "PDF 보고서", npcTaskId: "dev-20260408-a1b2", status: "in_progress", summary: "1분기 분석 중", createdAt: "2026-04-08T10:00:00Z" };
  const result = buildTaskSessionPrompt(task, "ko");
  assert.ok(result.includes("PDF 보고서"));
  assert.ok(result.includes("dev-20260408-a1b2"));
  assert.ok(result.includes("in_progress"));
  assert.ok(result.includes("1분기 분석 중"));
  assert.ok(result.includes("Task Management Protocol") || result.includes("태스크"));
});

test("buildTaskSessionPrompt works with null summary", () => {
  const { buildTaskSessionPrompt } = require("./task-prompt.js");
  const task = { title: "테스트", npcTaskId: "t-1", status: "pending", summary: null, createdAt: "2026-04-08T10:00:00Z" };
  const result = buildTaskSessionPrompt(task, "en");
  assert.ok(result.includes("테스트"));
  assert.ok(!result.includes("null"));
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx tsx --test src/lib/task-prompt.test.ts`
Expected: FAIL — `buildTaskSessionPrompt is not a function`

- [ ] **Step 3: 구현**

`src/lib/task-prompt.js`의 `module.exports` 앞에 추가:

```javascript
/**
 * 태스크 전용 세션에 주입할 시스템 프롬프트.
 * 기존 Task Management Protocol + 태스크 컨텍스트 정보를 결합.
 * @param {{ title: string, npcTaskId: string, status: string, summary: string | null, createdAt: string }} task
 * @param {string | null | undefined} locale
 * @returns {string}
 */
function buildTaskSessionPrompt(task, locale) {
  const context = [
    "[TASK CONTEXT]",
    `현재 태스크: ${task.title}`,
    `태스크 ID: ${task.npcTaskId}`,
    `상태: ${task.status}`,
    `생성일: ${task.createdAt}`,
  ];
  if (task.summary) {
    context.push(`최근 요약: ${task.summary}`);
  }
  context.push("");
  context.push("이 대화는 위 태스크 전용입니다.");
  context.push("태스크와 관련된 작업에 집중하되, 사용자의 추가 지시에 유연하게 대응하세요.");
  context.push("진행 상황 업데이트 시 반드시 json:task 블록을 포함하세요.");

  return context.join("\n") + "\n\n" + buildTaskCorePrompt(locale);
}
```

`module.exports`에 `buildTaskSessionPrompt` 추가:

```javascript
module.exports = {
  TASK_CORE_PROMPT,
  injectTaskPrompt,
  TASK_REMINDER,
  withTaskReminder,
  buildTaskCorePrompt,
  buildTaskReminder,
  normalizeTaskPromptLocale,
  buildTaskSessionPrompt,
};
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx tsx --test src/lib/task-prompt.test.ts`
Expected: ALL PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/task-prompt.js src/lib/task-prompt.test.ts
git commit -m "feat: add buildTaskSessionPrompt for per-task session context"
```

---

### Task 2: streamNpcResponse 세션 키 파라미터화

**Files:**
- Modify: `src/server/socket-handlers.ts:545-584`

- [ ] **Step 1: streamNpcResponse에 sessionKeyOverride 파라미터 추가**

`src/server/socket-handlers.ts`의 `streamNpcResponse` 함수 시그니처를 변경:

```typescript
async function streamNpcResponse(
  socket: Socket,
  npcId: string,
  npcConfig: NpcConfig,
  userId: string,
  message: string,
  attachments?: OpenClawAttachment[],
  sessionKeyOverride?: string,
): Promise<string> {
  const { agentId, _channelId, sessionKeyPrefix } = npcConfig;

  if (!agentId) {
    emitNpcSystemResponse(socket, npcId, "no_agent");
    return "";
  }

  const gateway = await getOrConnectGateway(_channelId);
  if (!gateway) {
    emitNpcSystemResponse(socket, npcId, "gateway_not_connected");
    return "";
  }

  const sessionKey = sessionKeyOverride || `${sessionKeyPrefix || npcId}-dm-${userId}`;
  // ... rest unchanged
```

기존 DM 호출(`npc:chat` 핸들러)은 `sessionKeyOverride` 없이 호출하므로 동작이 동일.

- [ ] **Step 2: 빌드 확인**

Run: `npx next build 2>&1 | grep -E "error|Error|✓" | head -5`
Expected: `✓ Compiled successfully`

- [ ] **Step 3: 커밋**

```bash
git add src/server/socket-handlers.ts
git commit -m "refactor: add sessionKeyOverride param to streamNpcResponse"
```

---

### Task 3: npc:task-chat 소켓 핸들러 추가

**Files:**
- Modify: `src/server/socket-handlers.ts`

- [ ] **Step 1: import 추가**

파일 상단에 `buildTaskSessionPrompt` import 추가 (기존 task-prompt.js require 옆):

```typescript
const { withTaskReminder, buildTaskSessionPrompt } = require("../lib/task-prompt.js") as {
  withTaskReminder: (msg: string, locale: string | null) => string;
  buildTaskSessionPrompt: (task: { title: string; npcTaskId: string; status: string; summary: string | null; createdAt: string }, locale: string | null) => string;
};
```

- [ ] **Step 2: npc:task-chat 핸들러 구현**

`npc:reset-chat` 핸들러 앞(약 1065줄 부근)에 추가:

```typescript
    // ----- npc:task-chat (per-task session) -----
    socket.on(
      "npc:task-chat",
      async (data: {
        npcId: string;
        taskId: string;
        message: string;
        files?: Array<{ name: string; type: string; size: number; data: ArrayBuffer }>;
      }) => {
        const { npcId, taskId, message, files } = data;
        chatLog(`← task-chat to ${npcId} task=${taskId}:`, message?.slice(0, 100));

        if (!npcId || !taskId || !message || typeof message !== "string") return;
        const trimmed = message.trim().slice(0, 500);
        if (!trimmed && (!files || files.length === 0)) return;

        // Rate limit
        const now = Date.now();
        const lastTime = lastChatTime.get(socket.id) || 0;
        if (now - lastTime < CHAT_COOLDOWN_MS) {
          emitNpcSystemResponse(socket, npcId, "wait_before_sending");
          return;
        }
        lastChatTime.set(socket.id, now);

        // Load NPC config
        const npcConfig = await getNpcConfig(npcId);
        if (!npcConfig) {
          emitNpcSystemResponse(socket, npcId, "npc_not_found");
          return;
        }

        // Load task from DB
        const task = await taskManager.getTaskByNpcTaskId(npcId, taskId);

        // File processing (same as npc:chat)
        let extractedFiles: ExtractedFile[] = [];
        let fileAttachments: OpenClawAttachment[] | undefined;

        if (files && files.length > 0) {
          if (files.length > FILE_LIMITS.maxFileCount) {
            emitNpcSystemResponse(socket, npcId, "too_many_files");
            return;
          }
          for (const f of files) {
            if (f.size > FILE_LIMITS.maxFileSize) {
              emitNpcSystemResponse(socket, npcId, "file_too_large");
              return;
            }
            if (!isAllowedFileType(f.name, f.type)) {
              emitNpcSystemResponse(socket, npcId, "unsupported_file_type");
              return;
            }
          }
          extractedFiles = await Promise.all(
            files.map((f) => extractFileContent(Buffer.from(f.data), f.name, f.type)),
          );
          fileAttachments = buildAttachments(extractedFiles);
        }

        // Build message with task session context
        const fileSection = buildFilePromptSection(extractedFiles);
        const taskContext = task
          ? buildTaskSessionPrompt(task, getSocketLocale(socket))
          : withTaskReminder(trimmed, getSocketLocale(socket));
        const messageToSend = taskContext + "\n\n" + trimmed + fileSection;

        // Session key: per-task
        const sessionKey = `${npcConfig.sessionKeyPrefix || npcId}-task-${taskId}`;

        chatLog(`  → task gateway (${npcConfig._name}): task=${taskId} msgLen=${messageToSend.length}`);
        const response = await streamNpcResponse(
          socket, npcId, npcConfig, user.userId, messageToSend, fileAttachments, sessionKey,
        );
        chatLog(`  ← task response (${npcConfig._name}):`, response ? response.slice(0, 150) : "(empty)");

        // Emit task-specific response events
        if (response) {
          const parsed = parseNpcResponse(response);
          const player = players.get(socket.id);
          if (player?.characterId) {
            await processNpcTaskActions(io, parsed, {
              channelId: npcConfig._channelId,
              npcId,
              npcName: npcConfig._name,
              assignerCharacterId: player.characterId,
              targetUserId: player.userId,
            });
          }
        }
      },
    );
```

- [ ] **Step 3: streamNpcResponse 응답 이벤트를 태스크별로 분기**

현재 `streamNpcResponse`는 `socket.emit("npc:response", ...)` 를 사용합니다. 태스크 대화에서도 같은 이벤트를 사용하되, 클라이언트가 `npcId`로 구분할 수 있으므로 변경 불필요. 단, 태스크 대화의 스트리밍 구분을 위해 `npc:task-chat` 핸들러 내에서 `streamNpcResponse` 호출 전에 태스크 ID를 포함하는 래퍼를 사용합니다.

`streamNpcResponse` 내부의 `onDelta` 콜백에서 emit하는 이벤트를 커스터마이즈할 수 있도록, 기존 `socket.emit("npc:response", { npcId, chunk: delta, done: false })` 부분을 확인합니다.

실제로는 클라이언트에서 `activeTaskId` 상태로 어떤 뷰에 스트리밍할지 결정하므로, 서버 이벤트 구분은 불필요합니다. 기존 `npc:response` 이벤트를 그대로 사용합니다.

- [ ] **Step 4: taskManager.getTaskByNpcTaskId 존재 확인**

`src/lib/task-manager.js`에 해당 함수가 있는지 확인합니다. 없으면 추가:

```javascript
// task-manager.js에 추가
async function getTaskByNpcTaskId(npcId, npcTaskId) {
  const rows = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.npcId, npcId), eq(schema.tasks.npcTaskId, npcTaskId)))
    .limit(1);
  return rows[0] ? normalizeTask(rows[0]) : null;
}
```

`module.exports`에 추가.

- [ ] **Step 5: 빌드 확인**

Run: `npx next build 2>&1 | grep -E "error|Error|✓" | head -5`
Expected: `✓ Compiled successfully`

- [ ] **Step 6: 커밋**

```bash
git add src/server/socket-handlers.ts src/lib/task-manager.js
git commit -m "feat: add npc:task-chat socket handler for per-task sessions"
```

---

### Task 4: TaskInlineCard 컴포넌트

**Files:**
- Create: `src/components/TaskInlineCard.tsx`

- [ ] **Step 1: 컴포넌트 구현**

```tsx
"use client";

interface TaskInlineCardProps {
  taskId: string;
  npcTaskId: string;
  title: string;
  status: string;
  onClick?: (taskId: string) => void;
}

const STATUS_STYLES: Record<string, { border: string; text: string; icon: string }> = {
  pending: { border: "border-l-text-muted", text: "text-text-muted", icon: "⏳" },
  in_progress: { border: "border-l-warning", text: "text-warning", icon: "🔄" },
  stalled: { border: "border-l-danger", text: "text-danger", icon: "⏸" },
  complete: { border: "border-l-success", text: "text-success", icon: "✅" },
  cancelled: { border: "border-l-text-dim", text: "text-text-dim", icon: "❌" },
};

export default function TaskInlineCard({ taskId, npcTaskId, title, status, onClick }: TaskInlineCardProps) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.pending;

  return (
    <button
      onClick={() => onClick?.(taskId)}
      className={`w-full text-left my-1 px-3 py-2 rounded-md border-l-3 ${style.border} bg-bg/60 hover:bg-surface transition-colors cursor-pointer`}
    >
      <div className={`text-xs font-semibold ${style.text}`}>
        {style.icon} {title}
      </div>
      <div className="text-[10px] text-text-dim mt-0.5">
        {status} · 클릭하여 태스크 대화 →
      </div>
    </button>
  );
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npx next build 2>&1 | grep -E "error|Error|✓" | head -5`

- [ ] **Step 3: 커밋**

```bash
git add src/components/TaskInlineCard.tsx
git commit -m "feat: add TaskInlineCard component for DM inline task cards"
```

---

### Task 5: TaskChatView 컴포넌트

**Files:**
- Create: `src/components/TaskChatView.tsx`

- [ ] **Step 1: 컴포넌트 구현**

```tsx
"use client";

import { useEffect, useRef } from "react";
import ChatInput from "./ChatInput";
import MarkdownContent from "./ui/MarkdownContent";
import { useT } from "@/lib/i18n";

export interface TaskMessage {
  role: "player" | "npc";
  content: string;
}

interface TaskChatViewProps {
  taskId: string;
  taskTitle: string;
  taskStatus: string;
  messages: TaskMessage[];
  isStreaming: boolean;
  onSend: (message: string, files?: File[]) => void;
  onBack: () => void;
}

const STATUS_BADGE: Record<string, { bg: string; text: string }> = {
  pending: { bg: "bg-text-muted/20", text: "text-text-muted" },
  in_progress: { bg: "bg-warning/20", text: "text-warning" },
  stalled: { bg: "bg-danger/20", text: "text-danger" },
  complete: { bg: "bg-success/20", text: "text-success" },
  cancelled: { bg: "bg-text-dim/20", text: "text-text-dim" },
};

export default function TaskChatView({
  taskId,
  taskTitle,
  taskStatus,
  messages,
  isStreaming,
  onSend,
  onBack,
}: TaskChatViewProps) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const badge = STATUS_BADGE[taskStatus] || STATUS_BADGE.pending;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex flex-col h-full">
      {/* Header: back + task title + status */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-surface/50">
        <button onClick={onBack} className="text-text-muted hover:text-text text-sm">
          ← {t("common.back")}
        </button>
        <span className="text-sm font-semibold text-text truncate flex-1">{taskTitle}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${badge.bg} ${badge.text}`}>
          {taskStatus}
        </span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {messages.length === 0 && (
          <div className="text-text-dim text-sm italic text-center py-4">
            {t("task.chatPlaceholder")}
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "player" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${
                msg.role === "player"
                  ? "bg-primary text-white"
                  : "bg-surface-raised text-text-secondary"
              }`}
            >
              {msg.role === "npc" ? <MarkdownContent content={msg.content} /> : msg.content}
              {msg.role === "npc" && isStreaming && i === messages.length - 1 && (
                <span className="inline-block w-1.5 h-4 bg-warning ml-0.5 animate-pulse rounded-sm" />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <ChatInput
        onSend={onSend}
        disabled={isStreaming}
        maxLength={500}
        autoFocus
        showFileUpload
        accentColor="amber"
      />
    </div>
  );
}
```

- [ ] **Step 2: i18n 키 추가**

`src/lib/i18n/locales/ko.ts`, `en.ts`, `ja.ts`, `zh.ts`에 추가:

```typescript
// ko.ts
"task.chatPlaceholder": "태스크에 대해 추가 지시를 보내보세요.",

// en.ts
"task.chatPlaceholder": "Send additional instructions about this task.",

// ja.ts
"task.chatPlaceholder": "タスクについて追加の指示を送信してください。",

// zh.ts
"task.chatPlaceholder": "发送关于此任务的额外指示。",
```

- [ ] **Step 3: 빌드 확인**

Run: `npx next build 2>&1 | grep -E "error|Error|✓" | head -5`

- [ ] **Step 4: 커밋**

```bash
git add src/components/TaskChatView.tsx src/lib/i18n/locales/
git commit -m "feat: add TaskChatView component for per-task conversations"
```

---

### Task 6: NpcDialog 3단계 네비게이션

**Files:**
- Modify: `src/components/NpcDialog.tsx`

- [ ] **Step 1: NpcDialogProps 확장 + activeTaskId 상태**

```typescript
import TaskChatView, { type TaskMessage } from "./TaskChatView";
import TaskInlineCard from "./TaskInlineCard";

export interface NpcChatMessage {
  role: "player" | "npc";
  content: string;
  taskCard?: { taskId: string; npcTaskId: string; title: string; status: string };
}

interface NpcDialogProps {
  npcName: string;
  npcId: string;
  messages: NpcChatMessage[];
  isStreaming: boolean;
  onSend: (message: string, files?: File[]) => void;
  onClose: () => void;
  // Task session
  tasks: Array<{ id: string; npcTaskId: string; title: string; status: string; summary: string | null }>;
  taskMessages: Map<string, TaskMessage[]>;
  isTaskStreaming: boolean;
  onTaskSend?: (taskId: string, message: string, files?: File[]) => void;
  onTaskClick?: (taskId: string) => void;
  activeTaskId: string | null;
  onSetActiveTaskId: (taskId: string | null) => void;
  // Existing task actions
  socket: Socket | null;
  onDeleteTask?: (taskId: string) => void;
  onRequestReportTask?: (taskId: string) => void;
  onResumeTask?: (taskId: string) => void;
  onCompleteTask?: (taskId: string) => void;
}
```

- [ ] **Step 2: 탭 네비게이션에 뱃지 추가**

탭 헤더에 활성 태스크 수를 뱃지로 표시:

```tsx
const activeTaskCount = tasks.filter(t => t.status === "pending" || t.status === "in_progress").length;

// 탭 렌더링
<div className="flex border-b border-gray-700">
  <button
    onClick={() => { setTab("chat"); onSetActiveTaskId(null); }}
    className={`flex-1 py-2 text-sm font-semibold ${tab === "chat" ? "text-amber-400 border-b-2 border-amber-400" : "text-gray-500"}`}
  >
    💬 {t("chat.tab")}
  </button>
  <button
    onClick={() => { setTab("task"); onSetActiveTaskId(null); }}
    className={`flex-1 py-2 text-sm font-semibold relative ${tab === "task" ? "text-amber-400 border-b-2 border-amber-400" : "text-gray-500"}`}
  >
    📋 {t("task.tab")}
    {activeTaskCount > 0 && (
      <span className="absolute -top-1 -right-1 bg-warning text-black text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
        {activeTaskCount}
      </span>
    )}
  </button>
</div>
```

- [ ] **Step 3: 태스크 대화 뷰 렌더링 분기**

태스크 탭에서 `activeTaskId`가 설정되면 TaskChatView를, 아니면 TaskPanel을 표시:

```tsx
{tab === "task" && (
  activeTaskId ? (
    <TaskChatView
      taskId={activeTaskId}
      taskTitle={tasks.find(t => t.npcTaskId === activeTaskId)?.title || activeTaskId}
      taskStatus={tasks.find(t => t.npcTaskId === activeTaskId)?.status || "pending"}
      messages={taskMessages.get(activeTaskId) || []}
      isStreaming={isTaskStreaming}
      onSend={(msg, files) => onTaskSend?.(activeTaskId, msg, files)}
      onBack={() => onSetActiveTaskId(null)}
    />
  ) : (
    <TaskPanel
      npcId={npcId}
      npcName={npcName}
      socket={socket}
      onTaskClick={(taskId) => onSetActiveTaskId(taskId)}
      onDeleteTask={onDeleteTask}
      onRequestReportTask={onRequestReportTask}
      onResumeTask={onResumeTask}
      onCompleteTask={onCompleteTask}
    />
  )
)}
```

- [ ] **Step 4: DM 메시지에 인라인 태스크 카드 렌더링**

메시지 렌더링 부분에서 `taskCard` 필드가 있으면 TaskInlineCard를 표시:

```tsx
{msg.taskCard && (
  <TaskInlineCard
    taskId={msg.taskCard.taskId}
    npcTaskId={msg.taskCard.npcTaskId}
    title={msg.taskCard.title}
    status={msg.taskCard.status}
    onClick={() => {
      setTab("task");
      onSetActiveTaskId(msg.taskCard!.npcTaskId);
    }}
  />
)}
```

- [ ] **Step 5: 빌드 확인**

Run: `npx next build 2>&1 | grep -E "error|Error|✓" | head -5`

- [ ] **Step 6: 커밋**

```bash
git add src/components/NpcDialog.tsx
git commit -m "feat: add 3-step navigation with task chat view in NpcDialog"
```

---

### Task 7: TaskPanel에 onTaskClick 추가

**Files:**
- Modify: `src/components/TaskPanel.tsx`

- [ ] **Step 1: Props에 onTaskClick 추가**

```typescript
interface TaskPanelProps {
  npcId: string;
  npcName: string;
  socket: Socket | null;
  onTaskClick?: (taskId: string) => void;   // <-- 추가
  onDeleteTask?: (taskId: string) => void;
  onRequestReportTask?: (taskId: string) => void;
  onResumeTask?: (taskId: string) => void;
  onCompleteTask?: (taskId: string) => void;
}
```

- [ ] **Step 2: TaskCard에 클릭 핸들러 전달**

TaskCard 렌더링 부분에서 카드 전체를 클릭 가능하게:

```tsx
<div
  key={task.id}
  onClick={() => onTaskClick?.(task.npcTaskId || task.id)}
  className="cursor-pointer hover:brightness-110 transition"
>
  <TaskCard task={task} compact ... />
</div>
```

- [ ] **Step 3: 커밋**

```bash
git add src/components/TaskPanel.tsx
git commit -m "feat: add onTaskClick callback to TaskPanel"
```

---

### Task 8: GamePageClient 태스크 메시지 상태 + 소켓 연결

**Files:**
- Modify: `src/app/game/GamePageClient.tsx`

- [ ] **Step 1: 태스크 메시지 상태 추가**

기존 `npcMessages` 상태 근처에:

```typescript
const [npcTaskMessages, setNpcTaskMessages] = useState<Map<string, Array<{ role: "player" | "npc"; content: string }>>>(new Map());
const [isTaskStreaming, setIsTaskStreaming] = useState(false);
const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
const taskStreamBufferRef = useRef("");
```

- [ ] **Step 2: handleTaskDialogSend 콜백**

```typescript
const handleTaskDialogSend = useCallback(
  async (taskId: string, message: string, files?: File[]) => {
    if (!socket || !dialogNpc) return;

    // Add player message to task messages
    setNpcTaskMessages((prev) => {
      const next = new Map(prev);
      const msgs = next.get(taskId) || [];
      msgs.push({ role: "player", content: message });
      next.set(taskId, [...msgs]);
      return next;
    });
    taskStreamBufferRef.current = "";
    setIsTaskStreaming(true);

    // Convert files
    let filePayloads: Array<{ name: string; type: string; size: number; data: ArrayBuffer }> | undefined;
    if (files && files.length > 0) {
      filePayloads = await Promise.all(
        files.map(async (f) => ({ name: f.name, type: f.type, size: f.size, data: await f.arrayBuffer() })),
      );
    }

    socket.emit("npc:task-chat", {
      npcId: dialogNpc.npcId,
      taskId,
      message,
      files: filePayloads,
    });
  },
  [socket, dialogNpc],
);
```

- [ ] **Step 3: npc:response에서 태스크 스트리밍 처리**

기존 `npc:response` 핸들러에서 `activeTaskId`에 따라 메시지를 분배:

```typescript
// 기존 npc:response 핸들러 수정
socket.on("npc:response", ({ npcId, chunk, done }) => {
  if (dialogNpc?.npcId !== npcId) return;

  if (activeTaskId) {
    // Task session streaming
    taskStreamBufferRef.current += chunk;
    setNpcTaskMessages((prev) => {
      const next = new Map(prev);
      const msgs = [...(next.get(activeTaskId) || [])];
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg?.role === "npc") {
        msgs[msgs.length - 1] = { role: "npc", content: taskStreamBufferRef.current };
      } else {
        msgs.push({ role: "npc", content: taskStreamBufferRef.current });
      }
      next.set(activeTaskId, msgs);
      return next;
    });
    if (done) {
      setIsTaskStreaming(false);
      taskStreamBufferRef.current = "";
    }
  } else {
    // DM session streaming (existing logic)
    // ... existing code unchanged
  }
});
```

- [ ] **Step 4: NpcDialog에 새 props 전달**

기존 NpcDialog 렌더링에 태스크 관련 props 추가:

```tsx
<NpcDialog
  npcName={dialogNpc.name}
  npcId={dialogNpc.npcId}
  messages={npcMessages}
  isStreaming={isStreaming}
  onSend={handleDialogSend}
  onClose={handleDialogClose}
  tasks={npcTasks}
  taskMessages={npcTaskMessages}
  isTaskStreaming={isTaskStreaming}
  onTaskSend={handleTaskDialogSend}
  activeTaskId={activeTaskId}
  onSetActiveTaskId={setActiveTaskId}
  socket={socket}
/>
```

- [ ] **Step 5: 빌드 확인**

Run: `npx next build 2>&1 | grep -E "error|Error|✓" | head -5`

- [ ] **Step 6: 커밋**

```bash
git add src/app/game/GamePageClient.tsx
git commit -m "feat: add task message state and socket handling in GamePageClient"
```

---

### Task 9: 태스크 생성 시 DM 인라인 카드 삽입

**Files:**
- Modify: `src/server/socket-handlers.ts`
- Modify: `src/app/game/GamePageClient.tsx`

- [ ] **Step 1: 서버에서 npc:task-created emit**

`socket-handlers.ts`의 `processNpcTaskActions` 함수에서 태스크 생성 시:

```typescript
// handleTaskAction(create) 후
if (taskAction.action === "create") {
  io.to(channelId).emit("npc:task-created", {
    npcId,
    task: { id: task.id, npcTaskId: task.npcTaskId, title: task.title, status: task.status },
  });
}
```

- [ ] **Step 2: 클라이언트에서 npc:task-created 수신**

GamePageClient에서 소켓 이벤트 수신:

```typescript
socket.on("npc:task-created", ({ npcId, task }) => {
  if (dialogNpc?.npcId !== npcId) return;
  // DM 메시지에 인라인 태스크 카드 추가
  setNpcMessages((prev) => [
    ...prev,
    { role: "npc", content: "", taskCard: { taskId: task.id, npcTaskId: task.npcTaskId, title: task.title, status: task.status } },
  ]);
});
```

- [ ] **Step 3: 커밋**

```bash
git add src/server/socket-handlers.ts src/app/game/GamePageClient.tsx
git commit -m "feat: emit task-created event and insert inline card in DM"
```

---

### Task 10: 태스크 완료 보고 — NPC 걸어오기 + DM 보고

**Files:**
- Modify: `src/server/socket-handlers.ts`
- Modify: `src/app/game/GamePageClient.tsx`

- [ ] **Step 1: 서버에서 완료 보고 emit**

`processNpcTaskActions`에서 complete 시:

```typescript
if (taskAction.action === "complete") {
  io.to(channelId).emit("npc:task-completed", {
    npcId,
    npcName,
    taskId: task.npcTaskId,
    title: task.title,
    summary: task.summary || taskAction.summary || "",
  });
}
```

- [ ] **Step 2: 클라이언트에서 완료 수신 → DM 보고 + NPC 이동**

```typescript
socket.on("npc:task-completed", ({ npcId, npcName, taskId, title, summary }) => {
  // DM에 완료 보고 메시지 삽입
  setNpcMessages((prev) => [
    ...prev,
    {
      role: "npc",
      content: `${summary || title + " 완료"}`,
      taskCard: { taskId, npcTaskId: taskId, title, status: "complete" },
    },
  ]);

  // NPC가 플레이어에게 걸어오기 (기존 walkToPlayer 로직 트리거)
  // GameScene의 EventBus를 통해 NPC 이동 요청
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("npc:walk-to-player", { detail: { npcId, npcName } }));
  }
});
```

- [ ] **Step 3: 빌드 확인**

Run: `npx next build 2>&1 | grep -E "error|Error|✓" | head -5`

- [ ] **Step 4: 커밋**

```bash
git add src/server/socket-handlers.ts src/app/game/GamePageClient.tsx
git commit -m "feat: task completion report with NPC walk-to-player and DM notification"
```

---

### Task 11: 통합 테스트 + 정리

**Files:**
- All modified files

- [ ] **Step 1: 전체 빌드 확인**

Run: `npm run build`
Expected: 성공

- [ ] **Step 2: 기존 테스트 통과 확인**

Run: `npx tsx --test src/lib/task-prompt.test.ts src/lib/file-extractor.test.ts`
Expected: ALL PASS

- [ ] **Step 3: dev 서버 수동 테스트**

Run: `npm run dev:debug`

테스트 시나리오:
1. NPC에게 "보고서 작성해줘" → 태스크 생성 → DM에 인라인 카드 표시 확인
2. 인라인 카드 클릭 → 태스크 대화 뷰 진입 확인
3. 태스크 대화에서 추가 지시 → 별도 세션 키 확인 (DEBUG_CHAT 로그)
4. DM 탭으로 돌아가서 일반 대화 → 태스크 컨텍스트 오염 없음 확인
5. 태스크 완료 → NPC 걸어오기 + DM 보고 확인

- [ ] **Step 4: 최종 커밋**

```bash
git add -A
git commit -m "feat: task session separation — per-task OpenClaw sessions with 3-step UI navigation"
```
