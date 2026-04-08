import test from "node:test";
import assert from "node:assert/strict";

// Test session key format
test("task session key format", () => {
  const taskId = "dev-20260408-a1b2";
  const sessionKeyPrefix = "ot-channel1";

  // DM session key (existing)
  const dmKey = `${sessionKeyPrefix}-dm-user1`;
  assert.equal(dmKey, "ot-channel1-dm-user1");

  // Task session key (new)
  const taskKey = `${sessionKeyPrefix}-task-${taskId}`;
  assert.equal(taskKey, "ot-channel1-task-dev-20260408-a1b2");

  // Keys must be different
  assert.notEqual(dmKey, taskKey);
});

test("task session keys are unique per task", () => {
  const prefix = "ot-ch1";
  const key1 = `${prefix}-task-task-001`;
  const key2 = `${prefix}-task-task-002`;
  assert.notEqual(key1, key2);
});

test("DM session key unchanged when no override", () => {
  const sessionKeyPrefix = "ot-npc1";
  const npcId = "npc-123";
  const userId = "user-456";

  // This mimics streamNpcResponse logic
  const sessionKeyOverride = undefined;
  const sessionKey = sessionKeyOverride || `${sessionKeyPrefix || npcId}-dm-${userId}`;
  assert.equal(sessionKey, "ot-npc1-dm-user-456");
});

test("session key uses override when provided", () => {
  const sessionKeyPrefix = "ot-npc1";
  const npcId = "npc-123";
  const userId = "user-456";

  const sessionKeyOverride = "ot-npc1-task-my-task-id";
  const sessionKey = sessionKeyOverride || `${sessionKeyPrefix || npcId}-dm-${userId}`;
  assert.equal(sessionKey, "ot-npc1-task-my-task-id");
});

test("session key falls back to npcId when prefix is empty", () => {
  const sessionKeyPrefix = "";
  const npcId = "npc-789";
  const userId = "user-abc";

  const sessionKey = `${sessionKeyPrefix || npcId}-dm-${userId}`;
  assert.equal(sessionKey, "npc-789-dm-user-abc");
});

test("task session key contains task ID for traceability", () => {
  const taskId = "peter-20260324-a7f3";
  const key = `ot-ch1-task-${taskId}`;
  assert.ok(key.includes(taskId));
  assert.ok(key.startsWith("ot-ch1-task-"));
});
