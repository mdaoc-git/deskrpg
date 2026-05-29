import type { AdapterExecuteOptions } from "./types";

import { CliBaseAdapter } from "./cli-base-adapter";

export class CodexAdapter extends CliBaseAdapter {
  readonly type = "codex";
  readonly cliCommand = "codex";

  buildArgs(options: AdapterExecuteOptions, sessionRef?: string): string[] {
    if (sessionRef) {
      const args = ["exec", "resume", sessionRef, "--dangerously-bypass-approvals-and-sandbox"];
      if (options.model) {
        args.push("--model", options.model);
      }
      return args;
    }

    const args = ["exec", "--dangerously-bypass-approvals-and-sandbox"];
    if (options.model) {
      args.push("--model", options.model);
    }
    args.push("-");
    return args;
  }

  parseStreamChunk(raw: string): string {
    return raw;
  }

  extractSessionId(fullOutput: string): string | undefined {
    return (
      fullOutput.match(/session(?:\s+id)?[:=]\s*([A-Za-z0-9._:-]+)/i)?.[1] ??
      fullOutput.match(/"session(?:_id|Id|Ref)"\s*:\s*"([^"]+)"/)?.[1]
    );
  }
}
