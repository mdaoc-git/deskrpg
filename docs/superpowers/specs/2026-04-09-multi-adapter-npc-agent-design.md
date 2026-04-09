# Multi-Adapter NPC Agent System Design

> 현재 OpenClaw 전용인 NPC 에이전트 시스템을 Claude Code, Codex CLI, Gemini CLI, OpenCode를 포함한 멀티 어댑터 구조로 확장. Adapter Registry 패턴으로 CLI 도구를 서버 사이드 subprocess로 실행하고, DM Hub 패턴으로 세션 간 컨텍스트를 연결한다.

## 1. 배경 및 목표

### 현재 상태
- NPC 에이전트는 OpenClaw 게이트웨이(WebSocket JSON-RPC)만 지원
- `npcs.openclawConfig` JSONB 컬럼에 에이전트 설정 저장
- 페르소나는 OpenClaw의 IDENTITY.md, SOUL.md 파일 시스템에 의존
- UI 컴포넌트(NpcHireModal, NpcDialog)가 OpenClaw에 강하게 결합
- 태스크 자동 넛지가 DM 세션에서 실행되어, 태스크 세션의 작업 내용을 알 수 없음

### 목표
- Claude Code, Codex CLI, Gemini CLI, OpenCode를 NPC 에이전트 백엔드로 지원
- Adapter 패턴으로 도구 추가 시 어댑터만 구현하면 되는 확장 가능한 구조
- NPC 단위 어댑터 선택 + 채널 기본값 override 지원
- DM Hub 패턴: DM 세션이 태스크 세션들을 모니터링하고 맥락을 연결
- 기존 태스크 시스템, 미팅 시스템과의 완전 호환
- API Key(BYOK) + CLI OAuth 로그인 양쪽 인증 지원

### 벤치마킹
- **Paperclip 프로젝트**: Adapter Registry 패턴, Session Codec, JWT 인증, Declarative Config Schema — 9개+ 어댑터로 검증된 프로덕션 아키텍처를 DeskRPG 규모에 맞게 채택

## 2. 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────┐
│                     DeskRPG Server                          │
│                                                             │
│  Socket.io Handlers                                         │
│       │                                                     │
│       ▼                                                     │
│  NPC Router ─── adapterType 분기 ──┐                        │
│       │                            │                        │
│       ▼                            ▼                        │
│  ┌──────────────────────────────────────────────┐           │
│  │            AdapterRegistry                    │           │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐     │           │
│  │  │ openclaw │ │ claude   │ │ codex    │ ... │           │
│  │  │ Adapter  │ │ Adapter  │ │ Adapter  │     │           │
│  │  └────┬─────┘ └────┬─────┘ └────┬─────┘     │           │
│  └───────┼─────────────┼─────────────┼──────────┘           │
│          │             │             │                      │
│     WebSocket RPC  SubprocessPool  SubprocessPool           │
│     (기존 방식)     (stdin pipe)   (stdin pipe)             │
│                                                             │
│  ┌──────────────────────────────────────────────┐           │
│  │ UserAuthStore                                 │           │
│  │ /var/deskrpg/users/{userId}/.claude/          │           │
│  │ /var/deskrpg/users/{userId}/.codex/           │           │
│  └──────────────────────────────────────────────┘           │
│                                                             │
│  ┌──────────────────────────────────────────────┐           │
│  │ WorkspaceStore                                │           │
│  │ /var/deskrpg/workspaces/{projectId}/          │           │
│  │   ├── CLAUDE.md  ├── GEMINI.md  ├── AGENTS.md│           │
│  └──────────────────────────────────────────────┘           │
│                                                             │
│  ┌──────────────────────────────────────────────┐           │
│  │ DM Hub (Cross-Session Context)                │           │
│  │ DM ←→ Task Sessions 요약 주입/조회            │           │
│  └──────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────┘
```

### 핵심 컴포넌트

| 컴포넌트 | 역할 |
|---------|------|
| **AdapterRegistry** | 어댑터 등록/조회 (`Map<string, NpcAdapter>`) |
| **NpcAdapter** | 모든 어댑터의 공통 인터페이스 |
| **CliBaseAdapter** | CLI 도구 공통 기반 클래스 (subprocess spawn) |
| **SubprocessPool** | CLI 프로세스 관리 (동시성 제한, 타임아웃, 정리) |
| **UserAuthStore** | 사용자별 CLI 인증 토큰 격리 저장 |
| **WorkspaceManager** | 프로젝트별 작업 디렉토리 + 페르소나 파일 관리 |
| **DmHub** | DM 세션에 태스크 대시보드 주입, 세션 간 컨텍스트 브릿지 |

## 3. 데이터 모델 변경

### 3.1 npcs 테이블 확장

```
추가: adapter_type  VARCHAR(20) NOT NULL DEFAULT 'openclaw'
추가: adapter_config  JSONB
유지: openclawConfig  (하위호환, 마이그레이션 후에도 유지)
```

`adapter_config` 네임스페이스 구조:

```jsonc
{
  "_type": "claude",              // 현재 활성 어댑터
  "_channelOverride": true,       // 채널 기본값 override 여부

  // 어댑터별 설정 (전환해도 보존)
  "openclaw": {
    "agentId": "agent-xxx",
    "sessionKeyPrefix": "ot-abc123",
    "personaConfig": { "identity": "...", "soul": "..." }
  },
  "claude": {
    "model": "claude-sonnet-4-20250514",
    "dangerouslySkipPermissions": true,
    "providerId": "provider-uuid-123"
  },
  "codex": {
    "model": "gpt-5.4",
    "dangerouslyBypassApprovalsAndSandbox": true,
    "providerId": "provider-uuid-456"
  },
  "gemini": {
    "model": "gemini-2.5-pro",
    "approvalMode": "yolo",
    "providerId": "provider-uuid-789"
  },
  "opencode": {
    "model": "anthropic/claude-sonnet-4-20250514",
    "dangerouslySkipPermissions": true,
    "providerId": "provider-uuid-123"
  }
}
```

어댑터 전환 시 기존 설정이 네임스페이스별로 보존되어, 다시 돌아와도 재설정 불필요.

### 3.2 provider_resources 테이블 (신규)

기존 `gatewayResources`의 일반화 버전. OpenClaw 게이트웨이, API 키, CLI OAuth 토큰을 모두 통합 관리.

```
id                    UUID PK
owner_user_id         UUID FK → users(id)
provider_type         VARCHAR(20) NOT NULL  -- 'anthropic', 'openai', 'google', 'openclaw'
display_name          VARCHAR(100)
auth_method           VARCHAR(20) NOT NULL  -- 'api_key', 'oauth_cli', 'gateway_token'
credentials_encrypted TEXT                  -- AES-256-GCM (기존 게이트웨이 암호화 방식 동일)
base_url              TEXT                  -- openclaw 게이트웨이 URL
last_validated_at     TIMESTAMPTZ
last_validation_status VARCHAR(20)
created_at            TIMESTAMPTZ DEFAULT NOW()
updated_at            TIMESTAMPTZ DEFAULT NOW()
```

### 3.3 provider_shares 테이블 (신규)

기존 `gatewayShares` 패턴 확장.

```
id           UUID PK
provider_id  UUID FK → provider_resources(id) ON DELETE CASCADE
user_id      UUID FK → users(id)
role         VARCHAR(10) DEFAULT 'use'  -- 'use', 'admin'
created_at   TIMESTAMPTZ DEFAULT NOW()
```

### 3.4 npc_sessions 테이블 (신규)

CLI 세션 ID를 논리적 세션 키에 매핑. DM Hub의 세션 요약 저장.

```
id            UUID PK
npc_id        UUID FK → npcs(id) ON DELETE CASCADE
user_id       UUID FK → users(id)
adapter_type  VARCHAR(20) NOT NULL
session_type  VARCHAR(20) NOT NULL      -- 'dm', 'task', 'meeting', 'summary'
session_ref   VARCHAR(200) NOT NULL     -- CLI 세션 ID or OpenClaw 세션 키
context_key   VARCHAR(200) NOT NULL     -- '{prefix}-dm-{userId}' 형태
last_summary  TEXT                      -- 세션 요약 (DM Hub용)
created_at    TIMESTAMPTZ DEFAULT NOW()
updated_at    TIMESTAMPTZ DEFAULT NOW()
UNIQUE(npc_id, user_id, context_key)
```

### 3.5 channels 테이블 확장

```
추가: default_adapter_type  VARCHAR(20) DEFAULT 'openclaw'
추가: default_provider_id   UUID FK → provider_resources(id)
```

기존 `gatewayConfig` JSONB에 어댑터 공통 설정 통합:

```jsonc
{
  "subprocess": {
    "maxConcurrent": 10,
    "maxPerNpc": 3,
    "timeoutMs": 180000,
    "coldStartTimeoutMs": 300000
  },
  "sessionRotation": {
    "enabled": false,
    "intervalMinutes": 1440
  },
  "taskAutomation": {
    "autoProgressNudgeEnabled": true,
    "autoProgressNudgeMinutes": 5,
    "autoProgressNudgeMax": 5,
    "reportWaitSeconds": 30
  }
}
```

### 3.6 마이그레이션 전략

1. `npcs` 테이블에 `adapter_type`, `adapter_config` 컬럼 추가
2. 기존 데이터: `adapter_type = 'openclaw'`, `adapter_config = { _type: "openclaw", openclaw: openclawConfig }`
3. `openclawConfig` 컬럼은 유지 (기존 코드 하위호환)
4. `provider_resources`, `provider_shares`, `npc_sessions` 테이블 생성
5. 기존 `gatewayResources` 데이터를 `provider_resources`로 마이그레이션 (`provider_type = 'openclaw'`, `auth_method = 'gateway_token'`)
6. `channels` 테이블에 `default_adapter_type`, `default_provider_id` 추가

## 4. Adapter 인터페이스

### 4.1 NpcAdapter 인터페이스

```typescript
// src/lib/adapters/types.ts

interface AdapterExecuteOptions {
  sessionKey: string;
  prompt: string;
  onDelta?: (chunk: string) => void;
  attachments?: AdapterAttachment[];
  model?: string;
  locale?: string;
  timeoutMs?: number;
  userId?: string;          // 인증 격리용
  projectId?: string;       // 워크스페이스 결정용
}

interface AdapterAttachment {
  type: "image" | "document" | "text";
  mimeType: string;
  fileName: string;
  content: string;          // base64 or extracted text
}

interface AdapterSessionInfo {
  sessionRef: string;       // CLI 세션 ID or OpenClaw 세션 키
  displayId?: string;
}

interface AdapterHealthResult {
  status: "ok" | "error" | "not_installed";
  message?: string;
  version?: string;
  model?: string;
}

interface AdapterConfigField {
  key: string;
  label: string;
  type: "text" | "select" | "toggle" | "number" | "textarea";
  options?: Array<{ value: string; label: string }>;
  default?: unknown;
  hint?: string;
  required?: boolean;
}

interface AdapterConfigSchema {
  fields: AdapterConfigField[];
}

interface NpcAdapter {
  readonly type: string;

  // 핵심
  execute(options: AdapterExecuteOptions): Promise<{
    response: string;
    session: AdapterSessionInfo;
  }>;

  abort?(sessionKey: string): Promise<void>;

  // 세션 관리
  getSessionSummary?(sessionKey: string): Promise<string>;
  resetSession?(sessionKey: string): Promise<void>;

  // 진단
  testConnection(config: Record<string, unknown>): Promise<AdapterHealthResult>;

  // UI
  getConfigSchema?(): AdapterConfigSchema;
}
```

### 4.2 AdapterRegistry

```typescript
// src/lib/adapters/registry.ts

class AdapterRegistry {
  private adapters = new Map<string, NpcAdapter>();

  register(adapter: NpcAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }

  get(type: string): NpcAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) throw new Error(`Unknown adapter type: ${type}`);
    return adapter;
  }

  has(type: string): boolean {
    return this.adapters.has(type);
  }

  listInstalled(): string[] {
    return [...this.adapters.keys()];
  }
}
```

서버 시작 시 사용 가능한 어댑터를 검사하여 등록. CLI 도구가 설치되지 않은 경우 해당 어댑터는 등록하지 않음.

### 4.3 CliBaseAdapter (공통 기반 클래스)

모든 CLI 어댑터의 공통 로직. subprocess spawn, 세션 매핑, 헬스 체크를 담당.

```typescript
// src/lib/adapters/cli-base.ts

abstract class CliBaseAdapter implements NpcAdapter {
  abstract readonly type: string;
  abstract readonly cliCommand: string;

  abstract buildArgs(options: AdapterExecuteOptions, sessionRef?: string): string[];
  abstract parseStreamChunk(raw: string): string;
  abstract extractSessionId(result: SubprocessResult): string | undefined;

  async execute(options: AdapterExecuteOptions) {
    // 1. DB에서 기존 세션 ID 조회
    // 2. WorkspaceManager로 cwd 준비
    // 3. 사용자 인증 디렉토리 설정 (HOME 환경변수)
    // 4. buildArgs()로 CLI 인수 구성
    // 5. SubprocessPool.execute() — stdin pipe로 프롬프트 전달
    // 6. 세션 ID 추출 + DB 저장
    // → { response, session }
  }

  async getSessionSummary(sessionKey: string) {
    // 해당 세션에 요약 요청 프롬프트 전송
  }

  async testConnection() {
    // CLI 설치 확인 + 버전 체크
    // 주의: execFile 사용 (exec 아님, shell injection 방지)
  }
}
```

### 4.4 어댑터별 구현

#### Claude Adapter

| 항목 | 값 |
|------|-----|
| CLI 명령 | `claude` |
| Headless 플래그 | `-p - --output-format stream-json` |
| Auto-approve | `--dangerously-skip-permissions` |
| 세션 재개 | `--resume {sessionRef}` |
| 모델 선택 | `--model {model}` |
| 출력 파싱 | stream-json 이벤트에서 assistant content 추출 |

#### Codex Adapter

| 항목 | 값 |
|------|-----|
| CLI 명령 | `codex` |
| Headless 플래그 | `exec -` (stdin에서 읽기) |
| Auto-approve | `--dangerously-bypass-approvals-and-sandbox` |
| 세션 재개 | `exec resume --last` |
| 출력 파싱 | text 출력 그대로 |

#### Gemini Adapter

| 항목 | 값 |
|------|-----|
| CLI 명령 | `gemini` |
| Headless 플래그 | `-p - -o stream-json` |
| Auto-approve | `--approval-mode yolo` |
| 세션 재개 | `--resume latest` |
| 모델 선택 | `-m {model}` |
| 출력 파싱 | stream-json 이벤트에서 content 추출 |

#### OpenCode Adapter

| 항목 | 값 |
|------|-----|
| CLI 명령 | `opencode` |
| Headless 플래그 | `run --format json -` |
| Auto-approve | runtime config `permission.external_directory=allow` 주입 |
| 세션 재개 | `-s {sessionRef}` 또는 `-c` |
| 출력 파싱 | JSON 이벤트에서 content 추출 |

#### OpenClaw Adapter (기존 코드 래핑)

기존 `OpenClawGateway` 클래스를 NpcAdapter 인터페이스로 래핑. WebSocket RPC 로직은 변경 없음.

## 5. SubprocessPool

CLI 도구 프로세스의 생명주기를 관리하는 풀.

### 설계 원칙
- `spawn()` 사용 (`exec()` 금지 — shell 해석 우회로 커맨드 인젝션 방지)
- 프롬프트는 `proc.stdin.write()` + `proc.stdin.end()`로 전달
- 환경변수에 사용자 입력 포함 금지

### 설정

| 파라미터 | 기본값 | 설명 |
|---------|-------|------|
| `maxConcurrent` | 10 | 서버 전체 동시 subprocess 최대 수 |
| `maxPerNpc` | 3 | NPC당 동시 세션 최대 |
| `idleTimeoutMs` | 300,000 | 5분 idle 시 강제 종료 |
| `timeoutMs` | 180,000 | 기본 실행 타임아웃 (3분) |
| `coldStartTimeoutMs` | 300,000 | 콜드 스타트 타임아웃 (5분) |

### 동작

1. 풀 여유 확인 → 대기열 or 즉시 실행
2. `spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] })`
3. stdin pipe로 프롬프트 전달
4. stdout 수집 + `onStdout` 콜백 (스트리밍 UI용)
5. stderr 수집 (로깅용)
6. 타임아웃 시 SIGTERM → 5초 후 SIGKILL
7. 완료 후 대기열 drain

### abort

`adapter.abort(sessionKey)` 호출 시:
- CLI 어댑터: 해당 프로세스에 SIGTERM
- OpenClaw: `gateway.chatAbort()` RPC (기존)

## 6. 인증

### 6.1 인증 방식 매트릭스

| Provider | API Key (BYOK) | CLI OAuth 로그인 | 비고 |
|----------|:---:|:---:|------|
| Anthropic | O | O | `claude auth login` device code flow |
| OpenAI | O | O | `codex login --device-auth` |
| Google | O | O | `gemini` + gcloud ADC |
| OpenCode | O (제공자별) | O | `opencode auth login` |
| OpenClaw | — | — | 기존 게이트웨이 토큰 방식 유지 |

### 6.2 CLI OAuth 로그인 플로우

CLI 도구가 직접 인증하는 방식. 약관 위반 없이 사용자 구독 플랜 사용 가능 (GitHub Codespaces에서 `claude auth login`하는 것과 동일한 패턴).

```
1. 사용자가 DeskRPG Provider 설정에서 "CLI 로그인" 클릭
2. 서버가 사용자별 격리 디렉토리에서 CLI 인증 명령 실행:
   HOME=/var/deskrpg/users/{userId} claude auth login
3. CLI가 device code + auth URL 반환
4. DeskRPG UI에 "이 링크에서 로그인하세요" + 인증 코드 표시
5. 사용자가 자기 브라우저에서 직접 인증
6. CLI가 polling → 인증 완료 → 토큰을 사용자 디렉토리에 저장
7. DeskRPG가 인증 상태 확인 → provider_resources에 기록
```

### 6.3 사용자별 인증 격리

```
/var/deskrpg/users/
├── {userId-1}/
│   ├── .claude/          ← claude auth login 토큰
│   ├── .codex/           ← codex login 토큰
│   ├── .config/gemini/   ← gemini 인증
│   └── .opencode/        ← opencode 인증
├── {userId-2}/
│   └── ...
```

NPC 실행 시: `HOME=/var/deskrpg/users/{userId}` 환경변수로 격리.

### 6.4 API Key 저장

- 기존 `gatewayResources.tokenEncrypted`와 동일한 AES-256-GCM 암호화
- 암호화 키: `INTERNAL_RPC_SECRET` → `JWT_SECRET` 순서로 fallback
- 형식: `v1:{iv_b64}:{auth_tag_b64}:{encrypted_b64}`
- 복호화는 subprocess 실행 직전, 환경변수로 주입 (메모리에만 존재)

### 6.5 약관 준수

| 방식 | 합법성 | 근거 |
|------|:---:|------|
| API Key (BYOK) | O | API 키는 명시적으로 프로그래밍적 사용 허용 |
| CLI OAuth 로그인 | O | 사용자가 CLI 도구를 직접 인증, 원격 환경에서 사용 (클라우드 IDE 패턴) |
| DeskRPG가 OAuth 클라이언트로 등록 | X | Anthropic/OpenAI는 제3자 OAuth 비공개, 토큰 프록시는 약관 위반 |
| 소비자 토큰 복사/붙여넣기 | X | 자격증명 공유 금지 조항 위반 |

## 7. 워크스페이스 & 페르소나

### 7.1 프로젝트 워크스페이스

```
/var/deskrpg/workspaces/{projectId}/
├── CLAUDE.md       ← Claude용 페르소나 + 태스크 프로토콜
├── GEMINI.md       ← Gemini용
├── AGENTS.md       ← Codex/OpenCode용
├── .claude/
│   └── settings.json
└── npcs/
    └── {npcId}/    ← NPC별 추가 컨텍스트 (필요 시)
```

모든 어댑터의 페르소나 파일을 동시에 배치. Claude는 CLAUDE.md만, Gemini는 GEMINI.md만 읽으므로 충돌 없음. NPC 어댑터 전환 시 워크스페이스 재구성 불필요.

### 7.2 페르소나 주입 (하이브리드)

| 상황 | 방식 |
|------|------|
| 복잡한 페르소나, 지속적 대화 | 프로젝트 파일 (CLAUDE.md 등)에 기록, cwd에서 실행 |
| 간단한 1회성 질문, 태스크 프롬프트 | system prompt prepend (stdin에 포함) |

### 7.3 어댑터별 페르소나 파일

| 어댑터 | 파일명 | 내용 |
|--------|--------|------|
| claude | `CLAUDE.md` | localized identity + soul + task protocol |
| codex | `AGENTS.md` | localized identity + soul + task protocol |
| opencode | `AGENTS.md` | 동일 (codex와 같은 파일) |
| gemini | `GEMINI.md` | localized identity + soul + task protocol |
| openclaw | — | 기존 방식: RPC로 IDENTITY.md, SOUL.md 업로드 |

기존 `npc-persona-presets.ts`, `npc-agent-defaults.ts`의 프리셋과 로컬라이제이션 시스템은 그대로 사용. 어댑터별 파일 이름만 다르게 출력.

## 8. DM Hub — Cross-Session Context

### 8.1 문제

현재 DM 세션과 태스크 세션이 완전히 격리되어 있어:
- DM에서 "태스크 어떻게 돼가?" → NPC가 DB의 title/summary만 보고 답변 (태스크 세션의 상세 대화 내용 모름)
- 자동 넛지가 DM 세션에서 실행 → 태스크 세션의 작업 맥락 없이 넛지

### 8.2 개선: DM을 태스크 오케스트레이터로

```
DM 세션 (Hub)
├── Active Tasks Dashboard (프롬프트에 자동 주입)
│   ├── 태스크 #1 요약 + 최근 업데이트 시각
│   ├── 태스크 #2 요약 + 최근 업데이트 시각
│   └── ...
├── 사용자와 대화 시 태스크 상황 파악 가능
├── 상세 내용 필요 시 → 태스크 세션에 요약 요청 → DM에 주입
└── 연관 태스크 → 기존 태스크 세션에 이어서 할당 가능

태스크 세션 (Spoke)
├── 독립적 작업 컨텍스트
├── 완료/업데이트 시 json:task 블록으로 DB summary 갱신
└── DB summary → DM 대시보드에 자동 반영
```

### 8.3 DM 프롬프트 강화

DM 세션의 모든 메시지에 태스크 대시보드를 주입:

```
[ACTIVE TASKS DASHBOARD]
- [in_progress] #peter-0324-a7f3 "데이터 분석"
   요약: CSV 파싱 완료, 시각화 작업 중 (5분 전 업데이트)
- [pending] #peter-0325-b8c2 "API 연동"
   요약: 대기 중

위 태스크들의 진행 상황을 파악하고 있습니다.
사용자가 태스크에 대해 질문하면 요약 기반으로 답변하세요.
상세 내용이 필요하면 응답에 [NEED_TASK_DETAIL:taskId] 마커를 포함하세요.
기존 태스크의 연속 작업이라면 [CONTINUE_TASK:taskId] 마커를 사용하세요.
```

### 8.4 마커 기반 세션 간 통신

| 마커 | 용도 | 처리 |
|------|------|------|
| `[NEED_TASK_DETAIL:taskId]` | DM NPC가 태스크 상세 내용 필요 | 태스크 세션에 요약 요청 → 결과를 DM에 주입 → 재응답 |
| `[CONTINUE_TASK:taskId]` | 연관 작업을 기존 태스크에 이어서 할당 | 해당 태스크 세션에 새 지시 전달 |

### 8.5 개선된 넛지 흐름

```
기존: 스케줄러 → DM 세션에 넛지 → NPC가 DM 컨텍스트에서 응답 (태스크 맥락 없음)

개선:
1. 스케줄러 → 태스크 세션에 넛지 전송
2. 태스크 세션에서 실제 작업 + json:task 블록 응답
3. json:task 파싱 → DB summary 갱신
4. DM 세션의 npc_sessions.last_summary 업데이트
5. 리포트 생성 → 사용자에게 전달
```

### 8.6 OpenClaw 동일 적용

DM Hub 개선은 어댑터에 독립적. OpenClaw에서도 동일하게:
- 넛지를 태스크 세션 키(`{prefix}-task-{taskId}`)로 실행
- 결과 요약을 DM 컨텍스트에 주입
- 기존 `runProgressNudgeForTask()`의 세션 키를 DM → 태스크로 변경

## 9. 기존 시스템 호환성

### 9.1 태스크 시스템 — 완전 호환

| 기능 | 변경 사항 |
|------|----------|
| 태스크 생성/할당 | 없음 (DB only) |
| NPC 태스크 작업 | `streamNpcResponse()` → `adapter.execute()` 위임 |
| 프로토콜 주입 | 없음 (`task-prompt.js` 그대로) |
| JSON 파싱 | 없음 (`task-parser.js` 그대로) |
| 자동 넛지 | 세션 키만 변경 (DM → 태스크) + DM 요약 주입 추가 |
| 완료 리포트 | 없음 (DB + socket 그대로) |

### 9.2 미팅 시스템 — 멀티 어댑터 혼용 지원

한 미팅에 서로 다른 어댑터의 NPC가 참여 가능:

```
미팅 참석자:
├── NPC "클로드" → claude adapter
├── NPC "코덱스" → codex adapter
└── NPC "오씨"   → openclaw adapter
```

변경: `MeetingBroker`가 단일 `gateway`를 받는 대신, NPC별로 어댑터를 resolve.

```typescript
// 기존
constructor(config: { gateway, agents, ... })

// 변경
constructor(config: { adapterResolver: (npcId) => NpcAdapter, agents, ... })
```

각 NPC의 poll/speak/summarize 호출 시 해당 NPC의 어댑터를 사용.

## 10. 세션 관리

### 10.1 세션 지속 정책

| 정책 | 설명 |
|------|------|
| **기본** | NPC-유저 쌍마다 영구 세션 (CLI 세션 ID를 DB에 저장, 재개 시 `--resume` 사용) |
| **새 대화** | 사용자가 UI에서 "새 대화" 클릭 → 기존 세션 아카이브 + 새 세션 시작 |
| **자동 로테이션** | 시스템 설정에서 활성화 시, 설정된 주기(예: 24시간)마다 자동 새 세션 |
| **컨텍스트 오버플로** | CLI 도구 자체의 auto-compaction에 위임 (4개 도구 모두 지원) |

### 10.2 세션 키 → CLI 세션 ID 매핑

```
논리적 세션 키                     CLI 세션 ID (npc_sessions 테이블)
{prefix}-dm-{userId}          →   claude session abc-123
{prefix}-task-{taskId}        →   claude session def-456
{prefix}-meeting-{channelId}  →   claude session ghi-789
```

OpenClaw는 기존처럼 세션 키를 직접 게이트웨이에 전달 (매핑 불필요).

### 10.3 어댑터 변경 시 세션

- 어댑터 변경 시 "새 대화로 시작됩니다" 경고 표시
- 이전 세션 데이터는 `npc_sessions`에 보존 (다시 돌아올 수 있으므로)
- 어댑터별 세션이 독립적이므로 데이터 손실 없음

## 11. NPC 생성 흐름 변경

### 기존 (OpenClaw 전용)
1. NpcHireModal에서 에이전트 생성
2. `POST /api/npcs/create-agent` → OpenClaw `agents.create` RPC
3. IDENTITY.md, SOUL.md 파일 업로드 RPC

### 변경 (멀티 어댑터)

```
NpcHireModal
├── 어댑터 선택 (채널 기본값 or 직접 선택)
│
├── openclaw 선택 시:
│   └── 기존 흐름 (agents.create RPC + 파일 업로드)
│
└── CLI 어댑터 선택 시:
    ├── Provider 선택 (등록된 provider_resources에서)
    ├── 모델 선택
    ├── 페르소나 프리셋 적용
    └── 저장 → DB에 adapter_config 기록 + WorkspaceManager로 페르소나 파일 생성
        (원격 에이전트 생성 불필요 — subprocess는 on-demand)
```

## 12. UI 설계

### 12.1 Provider 관리 페이지 (`/providers`)

기존 `/gateways` 페이지를 확장. 모든 AI Provider(OpenClaw 게이트웨이 포함)를 통합 관리.

- 등록된 Provider 목록 (타입, 인증 방식, 상태)
- Provider 추가: 타입 선택 → 인증 방식 선택 (API Key / CLI 로그인) → 설정
- CLI 로그인 시: device code + auth URL 표시 → polling → 완료
- 연결 테스트 버튼
- 공유 관리 (provider_shares)

### 12.2 NpcHireModal 확장

어댑터 타입에 따라 설정 폼 동적 전환 (Paperclip의 declarative config schema 방식):

- 어댑터 선택 드롭다운 (채널 기본값 / 직접 선택)
- Provider 선택 (해당 어댑터 타입의 사용 가능한 provider만 표시)
- 모델 선택
- 페르소나 프리셋 + 커스텀 편집
- 고급 설정 (auto-approve, 세션 로테이션)
- OpenClaw 선택 시: 기존 게이트웨이 페어링 + 에이전트 선택 UI 표시

### 12.3 NpcDialog 변경

- 하단에 현재 어댑터 타입 + 모델 표시
- "새 대화" 버튼 추가
- 어댑터에 따른 기능 차이 없음 (스트리밍 대화, 태스크, 파일 첨부 동일)

### 12.4 시스템 관리: CLI 도구 설치

관리자 UI에서 CLI 도구 설치/업데이트:

- 설치 상태 표시 (버전, 설치 여부)
- 런타임 설치 버튼 → 서버에서 설치 명령 실행
- Subprocess Pool 상태 모니터링

## 13. Docker 배포

### 13.1 빌드타임 선택적 설치

```dockerfile
ARG ENABLE_CLAUDE=false
ARG ENABLE_CODEX=false
ARG ENABLE_GEMINI=false
ARG ENABLE_OPENCODE=false

# 조건부 설치 (ARG 플래그 기반)
```

### 13.2 런타임 설치

관리자 UI에서 설치 버튼 → 서버에서 설치 명령 실행.
설치 상태는 `AdapterRegistry.listInstalled()`로 확인.

### 13.3 볼륨 마운트

```yaml
volumes:
  - deskrpg-users:/var/deskrpg/users          # 사용자 인증 토큰
  - deskrpg-workspaces:/var/deskrpg/workspaces # 프로젝트 워크스페이스
```

## 14. 보안

| 위협 | 대응 |
|------|------|
| 커맨드 인젝션 | `spawn()` + stdin pipe. shell argument로 프롬프트 전달 금지. `exec()` 사용 금지 |
| API 키 노출 | AES-256-GCM 암호화 저장. 복호화는 실행 직전, 환경변수로만 주입 |
| 인증 토큰 격리 | 사용자별 HOME 디렉토리 분리 |
| 프로세스 자원 고갈 | SubprocessPool 동시성 제한 + 타임아웃 |
| 권한 관리 | NPC 어댑터 override는 채널 소유자/관리자만 가능 (RBAC) |
| CLI OAuth 토큰 | CLI 도구가 자체 관리. DeskRPG는 토큰 직접 접근 안 함 |

## 15. 에러 핸들링 & 관측성

### 타임아웃

| 상황 | 타임아웃 |
|------|---------|
| 일반 대화 | 180초 (기존 유지) |
| 콜드 스타트 (첫 실행) | 300초 |
| 미팅 요약 | 60초 (기존 유지) |
| 폴링 (SPEAK/PASS) | 30초 |

어댑터별, 채널별 타임아웃 override 가능 (`channels.gatewayConfig.subprocess`).

### 로깅

```
[adapter] {type} subprocess start: npcId={id} pid={pid}
[adapter] {type} subprocess end: exitCode={code} duration={ms}ms
[adapter] {type} subprocess error: stderr={message}
[adapter] {type} session resumed: sessionRef={ref}
[adapter] {type} session created: sessionRef={ref}
```

### 헬스 체크 API

```
GET /api/adapters/status
→ 각 어댑터의 설치 여부, 버전 반환

POST /api/providers/{id}/test
→ API 키 유효성 또는 CLI 인증 상태 검증
```

## 16. CLI 도구 컨텍스트 오버플로 참고

4개 도구 모두 auto-compaction 지원. DeskRPG가 별도 관리할 필요 없음.

| 도구 | 자동 압축 시점 | 수동 명령 | 임계값 설정 |
|------|-------------|----------|-----------|
| Claude Code | ~85% (1M 토큰) | `/compact` | X |
| Codex | ~220K 토큰 | `/compact` | X |
| Gemini CLI | 설정 가능 (기본 20~50%) | `/compress` | O |
| OpenCode | 75% (하드코딩) | `/compact` | X |

headless 모드에서는 수동 명령 불가. 자동 compaction에만 의존.
