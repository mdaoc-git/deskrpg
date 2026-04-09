import assert from "node:assert/strict";
import test from "node:test";

import { CliBaseAdapter } from "./cli-base-adapter";
import type { AdapterExecuteOptions } from "./types";

class TestAdapter extends CliBaseAdapter {
  readonly type = "test";
  readonly cliCommand = "node";

  buildArgs(options: AdapterExecuteOptions, sessionRef?: string): string[] {
    const code = `
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
        const response = {
          content: ${JSON.stringify(options.model ?? "no-model")} + "|" + ${JSON.stringify(
            sessionRef ?? "new",
          )} + "|" + input + "|" + process.cwd() + "|" + (process.env.HOME ?? ""),
        };
        process.stdout.write(JSON.stringify(response) + "\\n");
        process.stdout.write(JSON.stringify({ sessionId: "session-from-output" }) + "\\n");
      });
    `;

    return ["-e", code];
  }

  parseStreamChunk(raw: string): string {
    try {
      const parsed = JSON.parse(raw) as { content?: string };
      return typeof parsed.content === "string" ? parsed.content : "";
    } catch {
      return "";
    }
  }

  extractSessionId(fullOutput: string): string | undefined {
    return fullOutput.match(/"sessionId":"([^"]+)"/)?.[1];
  }
}

test("CliBaseAdapter execute streams parsed stdout and stores extracted session refs", async () => {
  const adapter = new TestAdapter();
  const deltas: string[] = [];

  const first = await adapter.execute({
    sessionKey: "cli-base-execute",
    prompt: "hello",
    model: "test-model",
    onDelta: (chunk) => {
      deltas.push(chunk);
    },
  });

  assert.equal(first.response.includes("test-model|new|hello|"), true);
  assert.deepEqual(deltas, [first.response]);
  assert.equal(first.session.sessionRef, "session-from-output");

  const second = await adapter.execute({
    sessionKey: "cli-base-execute",
    prompt: "again",
  });

  assert.equal(second.response.includes("no-model|session-from-output|again|"), true);
  assert.equal(second.session.sessionRef, "session-from-output");

  await adapter.resetSession("cli-base-execute");

  const third = await adapter.execute({
    sessionKey: "cli-base-execute",
    prompt: "fresh",
  });

  assert.equal(third.response.includes("no-model|new|fresh|"), true);
});

test("CliBaseAdapter execute uses project workspace cwd and user auth home", async () => {
  const adapter = new TestAdapter();
  const result = await adapter.execute({
    sessionKey: "cli-base-workspace",
    prompt: "workspace",
    projectId: "project-42",
    userId: "user-7",
  });

  assert.match(result.response, /workspaces[\\/]+project-42/);
  assert.match(result.response, /users[\\/]+user-7/);
});

test("CliBaseAdapter testConnection reports CLI version output", async () => {
  const adapter = new TestAdapter();
  const health = await adapter.testConnection({});

  assert.equal(health.status, "ok");
  assert.match(health.version ?? "", /^v\d+\./);
});
