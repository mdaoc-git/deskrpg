import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

type WorkspaceManagerClass = typeof import("./workspace-manager").WorkspaceManager;

describe("WorkspaceManager", () => {
  let tempDir = "";
  let WorkspaceManagerCtor: WorkspaceManagerClass;
  let previousDataDir: string | undefined;

  const persona = {
    identity: "# Identity\nYou are a workspace NPC.",
    soul: "# Soul\nStay focused and helpful.",
  };

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "deskrpg-workspace-manager-"));
    previousDataDir = process.env.DESKRPG_DATA_DIR;
    process.env.DESKRPG_DATA_DIR = tempDir;

    ({ WorkspaceManager: WorkspaceManagerCtor } = await import("./workspace-manager"));
  });

  after(async () => {
    if (previousDataDir === undefined) {
      delete process.env.DESKRPG_DATA_DIR;
    } else {
      process.env.DESKRPG_DATA_DIR = previousDataDir;
    }

    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("ensureWorkspace creates directory and returns path", async () => {
    const workspaceManager = new WorkspaceManagerCtor();
    const wsPath = await workspaceManager.ensureWorkspace("project-123");

    assert.equal(wsPath, path.join(tempDir, "workspaces", "project-123"));

    const stats = await fs.stat(wsPath);
    assert.equal(stats.isDirectory(), true);
  });

  test("writePersonaFiles creates CLAUDE.md for claude adapter", async () => {
    const workspaceManager = new WorkspaceManagerCtor();
    const wsPath = await workspaceManager.ensureWorkspace("claude-project");

    await workspaceManager.writePersonaFiles(wsPath, "claude", persona, "ko");

    const content = await fs.readFile(path.join(wsPath, "CLAUDE.md"), "utf-8");
    assert.equal(content.length > 0, true);
  });

  test("writePersonaFiles creates AGENTS.md for codex adapter", async () => {
    const workspaceManager = new WorkspaceManagerCtor();
    const wsPath = await workspaceManager.ensureWorkspace("codex-project");

    await workspaceManager.writePersonaFiles(wsPath, "codex", persona, "ko");

    const content = await fs.readFile(path.join(wsPath, "AGENTS.md"), "utf-8");
    assert.equal(content.length > 0, true);
  });

  test("writePersonaFiles creates AGENTS.md for opencode adapter", async () => {
    const workspaceManager = new WorkspaceManagerCtor();
    const wsPath = await workspaceManager.ensureWorkspace("opencode-project");

    await workspaceManager.writePersonaFiles(wsPath, "opencode", persona, "ko");

    const content = await fs.readFile(path.join(wsPath, "AGENTS.md"), "utf-8");
    assert.equal(content.length > 0, true);
  });

  test("writePersonaFiles creates GEMINI.md for gemini adapter", async () => {
    const workspaceManager = new WorkspaceManagerCtor();
    const wsPath = await workspaceManager.ensureWorkspace("gemini-project");

    await workspaceManager.writePersonaFiles(wsPath, "gemini", persona, "ko");

    const content = await fs.readFile(path.join(wsPath, "GEMINI.md"), "utf-8");
    assert.equal(content.length > 0, true);
  });

  test("writePersonaFiles is no-op for openclaw adapter", async () => {
    const workspaceManager = new WorkspaceManagerCtor();
    const wsPath = await workspaceManager.ensureWorkspace("openclaw-project");

    await workspaceManager.writePersonaFiles(wsPath, "openclaw", persona, "ko");

    const files = await fs.readdir(wsPath);
    assert.deepEqual(files, []);
  });

  test("getUserAuthHome returns user-specific path", () => {
    const workspaceManager = new WorkspaceManagerCtor();
    const userHome = workspaceManager.getUserAuthHome("user-789");

    assert.equal(userHome, path.join(tempDir, "users", "user-789"));
  });

  test("ensureUserAuthHome creates directory", async () => {
    const workspaceManager = new WorkspaceManagerCtor();
    const userHome = await workspaceManager.ensureUserAuthHome("user-456");

    assert.equal(userHome, path.join(tempDir, "users", "user-456"));

    const stats = await fs.stat(userHome);
    assert.equal(stats.isDirectory(), true);
  });

  test("persona content includes both identity and soul sections", async () => {
    const workspaceManager = new WorkspaceManagerCtor();
    const wsPath = await workspaceManager.ensureWorkspace("persona-project");

    await workspaceManager.writePersonaFiles(wsPath, "claude", persona, "ko");

    const content = await fs.readFile(path.join(wsPath, "CLAUDE.md"), "utf-8");
    assert.match(content, /# Identity/);
    assert.match(content, /# Soul/);
    assert.match(content, /\n\n---\n\n/);
  });
});
