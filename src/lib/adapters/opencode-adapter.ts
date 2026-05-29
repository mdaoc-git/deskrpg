import type { AdapterExecuteOptions } from "./types";

import { CliBaseAdapter } from "./cli-base-adapter";

export class OpencodeAdapter extends CliBaseAdapter {
  readonly type = "opencode";
  readonly cliCommand = "opencode";

  buildArgs(options: AdapterExecuteOptions, sessionRef?: string): string[] {
    const args = ["run", "--format", "json"];

    if (options.model) {
      args.push("--model", options.model);
    }

    if (sessionRef) {
      args.push("-s", sessionRef);
    }

    args.push("-");
    return args;
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
    return (
      fullOutput.match(/"session(?:_id|Id|Ref)"\s*:\s*"([^"]+)"/)?.[1] ??
      fullOutput.match(/session(?:\s+id)?[:=]\s*([A-Za-z0-9._:-]+)/i)?.[1]
    );
  }
}
