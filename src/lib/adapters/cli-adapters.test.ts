import assert from "node:assert/strict";
import test from "node:test";

import { ClaudeAdapter } from "./claude-adapter";
import { CodexAdapter } from "./codex-adapter";
import { GeminiAdapter } from "./gemini-adapter";
import { OpencodeAdapter } from "./opencode-adapter";
import type { AdapterExecuteOptions } from "./types";

const baseOptions: AdapterExecuteOptions = {
  sessionKey: "session-key",
  prompt: "prompt",
};

test("CLI adapters expose the expected type names", () => {
  assert.equal(new ClaudeAdapter().type, "claude");
  assert.equal(new CodexAdapter().type, "codex");
  assert.equal(new GeminiAdapter().type, "gemini");
  assert.equal(new OpencodeAdapter().type, "opencode");
});

test("CLI adapters build default args without model or resume state", () => {
  assert.deepEqual(new ClaudeAdapter().buildArgs(baseOptions), [
    "-p",
    "-",
    "--output-format",
    "stream-json",
    "--dangerously-skip-permissions",
  ]);
  assert.deepEqual(new CodexAdapter().buildArgs(baseOptions), [
    "exec",
    "--dangerously-bypass-approvals-and-sandbox",
    "-",
  ]);
  assert.deepEqual(new GeminiAdapter().buildArgs(baseOptions), [
    "-p",
    "-",
    "-o",
    "stream-json",
    "--approval-mode",
    "yolo",
  ]);
  assert.deepEqual(new OpencodeAdapter().buildArgs(baseOptions), ["run", "--format", "json", "-"]);
});

test("CLI adapters include model flags when a model is provided", () => {
  const options = { ...baseOptions, model: "gpt-test" };

  assert.deepEqual(new ClaudeAdapter().buildArgs(options), [
    "-p",
    "-",
    "--output-format",
    "stream-json",
    "--dangerously-skip-permissions",
    "--model",
    "gpt-test",
  ]);
  assert.deepEqual(new CodexAdapter().buildArgs(options), [
    "exec",
    "--dangerously-bypass-approvals-and-sandbox",
    "--model",
    "gpt-test",
    "-",
  ]);
  assert.deepEqual(new GeminiAdapter().buildArgs(options), [
    "-p",
    "-",
    "-o",
    "stream-json",
    "--approval-mode",
    "yolo",
    "-m",
    "gpt-test",
  ]);
  assert.deepEqual(new OpencodeAdapter().buildArgs(options), [
    "run",
    "--format",
    "json",
    "--model",
    "gpt-test",
    "-",
  ]);
});

test("CLI adapters build resume args when a session ref exists", () => {
  assert.deepEqual(new ClaudeAdapter().buildArgs(baseOptions, "claude-session"), [
    "-p",
    "-",
    "--output-format",
    "stream-json",
    "--dangerously-skip-permissions",
    "--resume",
    "claude-session",
  ]);
  assert.deepEqual(new CodexAdapter().buildArgs(baseOptions, "codex-session"), [
    "exec",
    "resume",
    "codex-session",
    "--dangerously-bypass-approvals-and-sandbox",
  ]);
  assert.deepEqual(new GeminiAdapter().buildArgs(baseOptions, "gemini-session"), [
    "-p",
    "-",
    "-o",
    "stream-json",
    "--approval-mode",
    "yolo",
    "--resume",
    "latest",
  ]);
  assert.deepEqual(new OpencodeAdapter().buildArgs(baseOptions, "opencode-session"), [
    "run",
    "--format",
    "json",
    "-s",
    "opencode-session",
    "-",
  ]);
});

test("CLI adapter parseStreamChunk handles JSON and plain text without throwing", () => {
  assert.equal(
    new ClaudeAdapter().parseStreamChunk(
      JSON.stringify({ content_block: { text: "hello from claude" } }),
    ),
    "hello from claude",
  );
  assert.equal(new ClaudeAdapter().parseStreamChunk("not json"), "");

  assert.equal(new CodexAdapter().parseStreamChunk("codex plain text"), "codex plain text");
  assert.equal(
    new CodexAdapter().parseStreamChunk(JSON.stringify({ content: "json still returns raw" })),
    '{"content":"json still returns raw"}',
  );

  assert.equal(
    new GeminiAdapter().parseStreamChunk(JSON.stringify({ content: "hello from gemini" })),
    "hello from gemini",
  );
  assert.equal(new GeminiAdapter().parseStreamChunk("not json"), "");

  assert.equal(
    new OpencodeAdapter().parseStreamChunk(JSON.stringify({ content: "hello from opencode" })),
    "hello from opencode",
  );
  assert.equal(new OpencodeAdapter().parseStreamChunk("not json"), "");
});
