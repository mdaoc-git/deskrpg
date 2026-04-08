# Task Session Separation Design

NPC 대화형 태스크 시스템에서 **DM 세션과 태스크 세션을 분리**하여 컨텍스트 혼재를 방지하고, 여러 태스크를 독립적으로 추적·관리할 수 있게 한다.

## Problem

현재 NPC와의 모든 대화(일반 대화 + 태스크 진행)가 단일 OpenClaw 세션(`npc-{npcId}-dm-{userId}`)에서 처리된다. 태스크 A를 진행하다 태스크 B를 지시하면 같은 세션에서 컨텍스트가 섞여서:
- NPC가 이전 태스크 맥락을 잃음
- 일반 대화가 태스크 컨텍스트에 오염됨
- 여러 태스크의 진행 상황이 구분되지 않음

## Solution

DM 세션은 일반 대화 전용으로 유지하고, 각 태스크는 독립된 OpenClaw 세션에서 실행한다. UI는 기존 2탭(채팅/태스크) 구조를 유지하면서, 태스크 클릭 시 전용 대화 뷰로 진입한다.

---

## Architecture

### Session Key Strategy

| 세션 유형 | 세션 키 포맷 | 용도 |
|-----------|-------------|------|
| DM 세션 | `npc-{npcId}-dm-{userId}` | 일반 대화, 인사, 질문, 태스크 생성 지시 |
| 태스크 세션 | `npc-{npcId}-task-{taskId}` | 태스크 전용 대화, 추가 지시, 진행 보고 |

- DM 세션은 기존과 동일 (변경 없음)
- 태스크 세션은 태스크 생성 시 자동으로 생성됨
- 하나의 NPC가 동시에 여러 태스크 세션을 가질 수 있음
- 태스크 완료/취소 시 세션은 유지되지만 더 이상 활성 사용되지 않음

### Data Flow

```
1. 플레이어가 DM에서 "보고서 작성해줘" 발화
2. DM 세션에서 NPC 응답: "태스크 등록할게요" + json:task create
3. 서버: 태스크 DB 생성 + 태스크 세션 키 할당
4. 서버: 태스크 세션에 시스템 프롬프트 주입 (태스크 컨텍스트)
5. 서버: DM 대화에 인라인 태스크 카드 삽입
6. 플레이어가 태스크 탭에서 태스크 클릭 → 태스크 세션으로 대화
7. 태스크 완료 시 → NPC가 맵에서 플레이어에게 다가옴 → DM에 완료 보고
```

---

## UI Design

### NpcDialog 3-Step Navigation

현재 2탭(채팅/태스크) 구조를 유지하면서 3단계 네비게이션을 추가한다.

**Step 1: 채팅 탭 (DM 세션)**
- 기존 DM 대화와 동일
- 태스크 생성 시 인라인 태스크 카드가 대화에 삽입됨
- 태스크 카드 클릭 → Step 3으로 이동
- 태스크 완료 보고도 여기에 표시됨

**Step 2: 태스크 탭 (목록)**
- 현재 TaskPanel과 동일한 태스크 카드 목록
- 각 카드에 상태 아이콘 + 최종 업데이트 시간 표시
- 태스크 카드 클릭 → Step 3으로 이동
- 탭 아이콘에 활성 태스크 수 뱃지 표시

**Step 3: 태스크 대화 (태스크 세션)**
- 뒤로 가기(← 목록) 버튼으로 Step 2 복귀
- 상단에 태스크 제목 + 상태 뱃지 표시
- 태스크 전용 OpenClaw 세션에서 대화
- 파일 첨부, 추가 지시 가능 (기존 ChatInput 재사용)
- 시스템 프롬프트에 태스크 컨텍스트 주입

### Inline Task Card (DM 채팅 내)

태스크 생성 시 DM 대화에 삽입되는 인터랙티브 카드:

```
┌─────────────────────────────────┐
│ 📋 PDF 요약 보고서 작성          │
│ 상태: in_progress               │
│ 클릭하여 태스크 대화 →           │
└─────────────────────────────────┘
```

- 클릭 시 태스크 탭 → 해당 태스크 대화로 자동 이동
- 상태에 따라 색상 변경 (pending: 회색, in_progress: 주황, complete: 초록)

### Task Tab Badge

태스크 탭 아이콘 옆에 활성(pending + in_progress) 태스크 수를 뱃지로 표시:
- `📋 태스크 ②` — 활성 태스크 2개
- 완료된 태스크는 카운트에서 제외
- 새 태스크 생성 시 뱃지 애니메이션

---

## Task Session Prompt Injection

태스크 세션에서 NPC에게 주입하는 시스템 프롬프트:

```
[TASK CONTEXT]
현재 태스크: {task.title}
태스크 ID: {task.npcTaskId}
상태: {task.status}
생성일: {task.createdAt}
최근 요약: {task.summary}

이 대화는 위 태스크 전용입니다.
태스크와 관련된 작업에 집중하되, 사용자의 추가 지시에 유연하게 대응하세요.
진행 상황 업데이트 시 반드시 json:task 블록을 포함하세요.
```

기존 Task Management Protocol 프롬프트(`buildTaskCorePrompt`)도 함께 주입하여 `json:task` 블록 생성 규칙을 유지한다.

---

## Task Completion Notification

### Flow

1. 태스크 세션에서 NPC가 `json:task complete` 블록 생성
2. 서버가 태스크 상태를 `complete`로 업데이트
3. NPC가 게임맵에서 플레이어 캐릭터에게 걸어옴 (기존 `walkToPlayer` 동작)
4. DM 세션에 완료 보고 메시지 삽입:
   - NPC의 요약 발화 (태스크 세션의 최종 summary 기반)
   - 인라인 태스크 카드 (상태: complete, "상세 보고서 보기 →" 링크)
5. 태스크 탭 뱃지 업데이트

### DM 보고 메시지 생성

완료 보고 메시지는 **DM 세션에서 새로 생성하지 않고**, 태스크의 `summary` 필드를 기반으로 서버 측에서 조립한다. 이렇게 하면 DM 세션의 컨텍스트를 소비하지 않고 알림만 전달할 수 있다.

```typescript
// 서버 측 조립
const reportMessage = `${task.summary}\n\n📋 [상세 보고서 보기]`;
socket.emit("npc:response", { npcId, chunk: reportMessage, done: true, isTaskReport: true, taskId });
```

---

## Socket Events

### New Events

| 이벤트 | 방향 | 페이로드 | 용도 |
|--------|------|----------|------|
| `npc:task-chat` | client → server | `{ npcId, taskId, message, files? }` | 태스크 세션에 메시지 전송 |
| `npc:task-response` | server → client | `{ npcId, taskId, chunk, done }` | 태스크 세션 응답 스트리밍 |
| `npc:task-created` | server → client | `{ npcId, task }` | 태스크 생성 알림 (뱃지 업데이트) |
| `npc:task-completed` | server → client | `{ npcId, taskId, summary }` | 태스크 완료 알림 + DM 보고 |

### Existing Events (변경 없음)

- `npc:chat` — DM 세션 메시지 (기존 동작 유지)
- `npc:response` — DM 세션 응답 (기존 동작 유지)
- `task:updated`, `task:deleted` — 태스크 상태 변경 (기존 동작 유지)

---

## Server Changes

### socket-handlers.ts

1. **`npc:task-chat` 핸들러 추가**
   - 세션 키: `npc-{npcId}-task-{taskId}`
   - 태스크 컨텍스트 시스템 프롬프트 주입
   - `streamNpcResponse` 호출 시 태스크 세션 키 사용
   - 응답에서 `json:task` 파싱 → 태스크 상태 업데이트

2. **태스크 생성 시 세션 초기화**
   - `handleTaskAction(create)` 에서 `npc:task-created` emit
   - DM 대화에 인라인 태스크 카드 삽입

3. **태스크 완료 보고 흐름**
   - `handleTaskAction(complete)` 에서:
     - NPC walkToPlayer 트리거
     - DM에 완료 보고 메시지 emit
     - `npc:task-completed` emit

### task-prompt.js

1. **`buildTaskSessionPrompt(task, locale)` 함수 추가**
   - 태스크 세션 전용 시스템 프롬프트 생성
   - 기존 `buildTaskCorePrompt` + 태스크 컨텍스트 결합

---

## Component Changes

### NpcDialog.tsx

1. **상태 추가**: `activeTaskId: string | null`
   - `null`: 채팅 또는 태스크 목록 표시
   - `string`: 해당 태스크 전용 대화 표시

2. **태스크 대화 뷰 렌더링**
   - `activeTaskId`가 설정되면 태스크 전용 ChatInput + 메시지 목록 표시
   - 뒤로 가기 버튼으로 `activeTaskId = null`

3. **인라인 태스크 카드 컴포넌트**
   - DM 메시지에 태스크 카드를 렌더링하는 `TaskInlineCard` 컴포넌트
   - 클릭 시 `activeTaskId` 설정 + 태스크 탭 활성화

### TaskPanel.tsx

1. **카드 클릭 핸들러**
   - `onTaskClick(taskId)` 콜백 추가
   - 클릭 시 부모(NpcDialog)에 `activeTaskId` 전달

### GamePageClient.tsx

1. **`handleTaskDialogSend` 추가**
   - `socket.emit("npc:task-chat", { npcId, taskId, message, files })`
   - 태스크 세션 응답 수신: `socket.on("npc:task-response", ...)`

2. **태스크 메시지 상태 관리**
   - `npcTaskMessages: Map<string, Message[]>` — 태스크별 메시지 목록
   - DM 메시지(`npcMessages`)와 분리

---

## Database Changes

### tasks 테이블 변경 없음

기존 `tasks` 테이블 스키마를 그대로 사용한다. 세션 키는 `npcId + npcTaskId`로 런타임에 생성하므로 DB 변경 불필요.

### 태스크 대화 이력

태스크 세션의 대화 이력은 **OpenClaw 세션에 저장**된다 (현재 DM 대화와 동일). 별도 DB 테이블 불필요.

클라이언트 측 `npcTaskMessages`는 메모리에만 유지하고, 태스크 대화 뷰 진입 시 빈 상태에서 시작한다. OpenClaw 세션이 컨텍스트를 유지하므로 NPC는 이전 대화를 기억한다.

---

## Migration Strategy

### Phase 1: 세션 분리 (백엔드)
- `npc:task-chat` 소켓 핸들러 추가
- `buildTaskSessionPrompt` 구현
- 태스크 생성 시 `npc:task-created` emit

### Phase 2: UI 변경 (프론트엔드)
- NpcDialog에 `activeTaskId` 상태 + 태스크 대화 뷰
- TaskPanel 카드 클릭 핸들러
- 인라인 태스크 카드 컴포넌트
- 태스크 탭 뱃지

### Phase 3: 완료 보고 개선
- DM 완료 보고 메시지 조립
- NPC walkToPlayer + 보고 연동
- 태스크 카드 링크에서 대화 뷰로 이동

---

## Out of Scope

- 태스크 우선순위 (별도 이슈)
- 태스크 의존성/서브태스크 (별도 이슈)
- 태스크 코멘트 테이블 (현재 summary 필드로 충분)
- 자동 넛지의 태스크 세션 적용 (현재 DM 세션에서 동작, 추후 마이그레이션)
