# Task Backlog & Kanban DnD Design

> 사용자가 NPC 대화 없이 태스크를 미리 등록(백로그)하고, 드래그앤드롭 칸반 보드에서 상태를 관리하며, NPC에 할당하여 자동 실행할 수 있는 기능.

## 1. 배경 및 목표

### 현재 상태
- 태스크는 NPC 대화에서만 생성 가능 (NPC 응답 파싱 → upsert)
- `tasks.npcId`는 NOT NULL FK — 백로그(미할당) 개념 없음
- TaskBoard는 4컬럼 칸반 (Pending, In Progress, Stalled, Done) — 읽기 전용, 드래그 불가
- 상태: `pending` → `in_progress` → `stalled` → `complete` / `cancelled`

### 목표
- 사용자가 직접 태스크를 미리 등록하고, 원하는 시점에 원하는 NPC에 할당
- 전체 칸반 드래그앤드롭으로 자유로운 상태 전환
- 클릭 할당도 지원하는 하이브리드 UX
- NPC 할당 시 자동 실행 트리거 (첫 메시지 자동 생성)

## 2. 데이터 모델 변경

### tasks 테이블

```
변경: npcId  UUID NOT NULL FK → UUID NULLABLE FK
추가: 없음 (기존 컬럼으로 충분)
```

- `npcId = NULL` → 백로그 (미할당)
- `npcId = 값` → NPC에 할당됨

### 상태 확장

```
추가: backlog (새 상태)
전체: backlog → pending → in_progress → stalled → complete / cancelled
```

| 상태 | 의미 | npcId |
|------|------|-------|
| `backlog` | 미할당, 사용자가 미리 등록 | NULL |
| `pending` | NPC 할당됨, 대기 중 (실행 전) | 필수 |
| `in_progress` | NPC 실행 중 | 필수 |
| `stalled` | 자동 nudge 한도 초과 | 필수 |
| `complete` | 완료 | 필수 |
| `cancelled` | 취소 | nullable |

### 태스크 생성 입력

- **제목** (필수, 200자)
- **설명** (선택, 마크다운 텍스트)
- `assignerId`: 생성한 캐릭터 ID (자동)
- `channelId`: 현재 채널 (자동)

## 3. API & 소켓 이벤트

### REST API 추가

- **`POST /api/tasks`** — 백로그 태스크 생성
  - Body: `{ channelId, title, summary? }`
  - 인증: `x-user-id` 헤더
  - 응답: 생성된 태스크 객체 (`status: "backlog"`, `npcId: null`)

### 소켓 이벤트 추가

| 이벤트 | 방향 | Payload | 용도 |
|--------|------|---------|------|
| `task:create` | client→server | `{ channelId, title, summary?, npcId? }` | 태스크 생성 (npcId 있으면 pending, 없으면 backlog) |
| `task:move` | client→server | `{ taskId, toStatus, npcId? }` | 상태 전환 (DnD 또는 클릭) |

### 기존 이벤트 재사용

- `task:updated` (server→client) — 상태 변경 브로드캐스트 (기존)
- `task:deleted` (server→client) — 삭제 브로드캐스트 (기존)
- `task:list` / `task:list-response` — 목록 조회 (기존, backlog 포함하도록 확장)
- `npc:task-response` — 자동 실행 시 NPC 스트리밍 응답 (기존)

## 4. 상태 전환 규칙

자유 이동. 드롭 시 상태별 액션 자동 트리거.

### 전환 매트릭스

| From → To | 액션 | NPC 모달 |
|-----------|------|----------|
| backlog → pending | NPC 할당 | 예 (미할당이면) |
| backlog → in_progress | NPC 할당 + 자동 실행 | 예 |
| backlog → complete | NPC 할당 + 즉시 완료 | 예 |
| backlog → cancelled | 취소 처리 | 아니오 |
| pending → in_progress | 실행 트리거 (자동 첫 메시지) | 아니오 |
| pending → backlog | NPC 할당 해제 (npcId = NULL) | 아니오 |
| in_progress → stalled | stalled 처리 | 아니오 |
| in_progress → complete | task:complete 트리거 | 아니오 |
| in_progress → pending | 일시 중단 (대기로 되돌림) | 아니오 |
| stalled → in_progress | task:resume 트리거 | 아니오 |
| complete → in_progress | 재실행 (재개 트리거) | 아니오 |
| any → cancelled | 취소 처리 | 아니오 |

### NPC 모달 조건

`npcId`가 NULL인 태스크가 `backlog`/`cancelled` 이외의 컬럼으로 이동할 때만 NPC 선택 모달 표시.

### 서버 측 `task:move` 핸들러

```
task:move({ taskId, toStatus, npcId? })
  1. DB에서 현재 태스크 조회
  2. 유효성 검사:
     - toStatus가 backlog/cancelled가 아닌데 npcId 없으면 → 에러 반환
  3. DB 업데이트:
     - status = toStatus
     - toStatus === "backlog" → npcId = NULL
     - npcId 제공되면 → npcId 업데이트
  4. 액션 트리거:
     - toStatus === "in_progress" && from backlog/pending → 자동 실행
     - toStatus === "complete" → 완료 처리
     - toStatus === "cancelled" → 취소 처리
  5. task:updated 브로드캐스트
```

## 5. 자동 실행 트리거

### in_progress 전환 시 (from backlog/pending)

```
1. buildTaskSessionPrompt(task) 호출
   - 시스템 메시지: "새 태스크가 할당되었습니다: [제목]. [설명]. 작업을 시작하세요."
2. streamNpcResponse() 호출 → OpenClaw 게이트웨이에 요청
3. npc:task-response 스트리밍 → 클라이언트 전달
4. 토스트 알림: "[NPC이름]이 '[제목]' 태스크를 시작했습니다"
```

### NPC 패널에서 직접 생성 시

```
1. TaskPanel "태스크 추가" 클릭 → TaskCreateForm 인라인 표시
2. 제목/설명 입력 → socket.emit("task:create", { channelId, npcId, title, summary })
3. 서버: npcId 있으므로 status = "pending"으로 생성 (즉시 실행 아님)
4. task:updated 브로드캐스트
```

## 6. UI 컴포넌트 설계

### 새로 만들 컴포넌트

| 컴포넌트 | 파일 | 역할 |
|---------|------|------|
| `TaskCreateForm` | `src/components/TaskCreateForm.tsx` | 백로그 태스크 생성 폼 (제목 + 설명 입력) |
| `NpcAssignModal` | `src/components/NpcAssignModal.tsx` | NPC 선택 리스트형 모달 |
| `DraggableTaskCard` | `src/components/DraggableTaskCard.tsx` | TaskCard 래퍼, HTML5 draggable + drag 이벤트 |
| `DroppableColumn` | `src/components/DroppableColumn.tsx` | 컬럼 드롭 존, 드래그 오버 시 하이라이트 |

### 기존 컴포넌트 수정

| 컴포넌트 | 변경 |
|---------|------|
| `TaskBoard` | 5컬럼 레이아웃, DnD 오케스트레이션, backlog 필터, NPC 모달 연동 |
| `TaskCard` | "할당" 버튼 조건부 표시 (backlog일 때만) |
| `TaskPanel` | "태스크 추가" 버튼 + TaskCreateForm 인라인 토글 |

### TaskBoard 칸반 레이아웃 (5컬럼)

```
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ 📥 백로그 │ ⏳ 대기   │ 🔄 진행중 │ ⏸ 중단   │ ✅ 완료  │
│          │          │          │          │          │
│ [+ 새   ] │          │          │          │          │
│ [태스크  ] │          │          │          │          │
│          │          │          │          │          │
│ ┌──────┐ │ ┌──────┐ │ ┌──────┐ │ ┌──────┐ │ ┌──────┐ │
│ │카드   │ │ │카드   │ │ │카드   │ │ │카드   │ │ │카드   │ │
│ │미할당 │ │ │🤖NPC │ │ │🤖NPC │ │ │🤖NPC │ │ │🤖NPC │ │
│ │[할당] │ │ │      │ │ │      │ │ │[재개] │ │ │      │ │
│ └──────┘ │ └──────┘ │ └──────┘ │ └──────┘ │ └──────┘ │
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

### NPC 선택 모달 (리스트형)

- 세로 리스트로 NPC 표시
- 각 NPC: 아바타 + 이름 + 현재 작업량 (진행 중/대기 수) + 활성 상태
- 비활성 NPC (게이트웨이 미연결): 반투명 처리, 선택 불가
- 선택된 NPC: 파란 테두리 하이라이트
- 하단: 취소 / 할당 버튼

### 드래그앤드롭 시각 피드백

- **드래그 시작**: 원본 카드 `opacity: 0.4`
- **드래그 오버**: 대상 컬럼 `border: 2px dashed #3b82f6` + 배경 미세 하이라이트
- **드롭 성공**: 짧은 페이드인 애니메이션
- **드롭 불가** (해당 없음 — 자유 이동이므로 모든 컬럼이 드롭 가능)

## 7. 구현 접근법

**HTML5 네이티브 DnD** (1차) + 점진적 @dnd-kit 마이그레이션 (필요시)

- `draggable`, `onDragStart/Over/Drop` 네이티브 이벤트 사용
- 클릭 할당 버튼도 함께 지원 (모바일 폴백)
- 상태 전환 로직은 DnD/클릭 공통으로 추출하여 재사용
- 터치 디바이스는 클릭 할당으로 폴백

## 8. 스키마 마이그레이션

### PostgreSQL

```sql
ALTER TABLE tasks ALTER COLUMN npc_id DROP NOT NULL;
```

### SQLite

SQLite는 ALTER COLUMN을 지원하지 않으므로, `ensureSqliteCompatibility()`에서 처리:
- 새 DB: 스키마에서 `npcId`를 nullable로 정의
- 기존 DB: SQLite는 이미 FK 강제가 느슨하므로 NULL 삽입 가능 (pragma foreign_keys 의존)
- `sqlite-base-schema.js`도 동기화

## 9. i18n

새 번역 키 추가 (4개 언어: en/ko/ja/zh):

- `task.backlog` — "백로그" / "Backlog"
- `task.createNew` — "새 태스크" / "New Task"
- `task.assign` — "할당" / "Assign"
- `task.assignToNpc` — "NPC에 할당" / "Assign to NPC"
- `task.selectNpc` — "NPC 선택" / "Select NPC"
- `task.unassigned` — "미할당" / "Unassigned"
- `task.autoStarted` — "[NPC]이 '[제목]' 태스크를 시작했습니다"
- `task.addToNpc` — "이 NPC에 태스크 추가"

## 10. 테스트 계획

### 단위 테스트
- `task:move` 핸들러: 모든 상태 전환 조합 검증
- `task:create`: backlog (npcId 없음) / pending (npcId 있음) 분기
- NPC 모달 조건 로직

### 통합 테스트
- 백로그 생성 → 드래그 → NPC 할당 → 자동 실행 전체 흐름
- NPC 패널에서 직접 생성 → pending 상태 확인
- 자유 이동: complete → in_progress 재실행 검증

### E2E 시나리오
- TaskBoard에서 백로그 태스크 생성
- 카드를 In Progress 컬럼으로 드래그 → NPC 모달 → 할당
- NPC 자동 첫 메시지 수신 확인
- TaskChatView에서 태스크 대화 확인
