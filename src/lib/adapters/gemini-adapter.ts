import type { AdapterExecuteOptions } from "./types";

import { CliBaseAdapter } from "./cli-base-adapter";

export class GeminiAdapter extends CliBaseAdapter {
  readonly type = "gemini";
  readonly cliCommand = "gemini";

  buildArgs(options: AdapterExecuteOptions, sessionRef?: string): string[] {
    const args = ["-p", "-", "-o", "stream-json", "--approval-mode", "yolo"];

    if (options.model) {
      args.push("-m", options.model);
    }

    if (sessionRef) {
      args.push("--resume", "latest");
    }

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
