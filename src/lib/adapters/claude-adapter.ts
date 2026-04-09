import type { AdapterExecuteOptions } from "./types";

import { CliBaseAdapter } from "./cli-base-adapter";

export class ClaudeAdapter extends CliBaseAdapter {
  readonly type = "claude";
  readonly cliCommand = "claude";

  buildArgs(options: AdapterExecuteOptions, sessionRef?: string): string[] {
    const args = ["-p", "-", "--output-format", "stream-json", "--dangerously-skip-permissions"];

    if (options.model) {
      args.push("--model", options.model);
    }

    if (sessionRef) {
      args.push("--resume", sessionRef);
    }

    return args;
  }

  parseStreamChunk(raw: string): string {
    try {
      const parsed = JSON.parse(raw) as {
        type?: string;
        text?: string;
        delta?: { text?: string };
        content?: string;
        message?: { content?: Array<{ text?: string }> | string };
        content_block?: { text?: string };
      };

      if (typeof parsed.content === "string") return parsed.content;
      if (typeof parsed.delta?.text === "string") return parsed.delta.text;
      if (typeof parsed.content_block?.text === "string") return parsed.content_block.text;
      if (typeof parsed.message?.content === "string") return parsed.message.content;
      if (Array.isArray(parsed.message?.content)) {
        return parsed.message.content
          .map((entry) => entry.text)
          .filter((text): text is string => typeof text === "string")
          .join("");
      }
      if (parsed.type?.includes("assistant") && typeof parsed.text === "string") {
        return parsed.text;
      }
      return "";
    } catch {
      return "";
    }
  }

  extractSessionId(fullOutput: string): string | undefined {
    return fullOutput.match(/"session(?:_id|Id|Ref)"\s*:\s*"([^"]+)"/)?.[1];
  }
}
