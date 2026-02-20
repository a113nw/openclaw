/**
 * Minimal test plugin — registers 1 tool, 1 hook, 1 service, 1 command.
 */
export function register(api: {
  registerTool: (tool: Record<string, unknown>, opts?: Record<string, unknown>) => void;
  on: (hookName: string, handler: (event: unknown) => unknown) => void;
  registerService: (service: Record<string, unknown>) => void;
  registerCommand: (command: Record<string, unknown>) => void;
}) {
  api.registerTool({
    name: "test-echo",
    description: "Echoes the input",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string" },
      },
    },
    execute: async (args: Record<string, unknown>) => {
      return { echo: args.message };
    },
  });

  api.on("session_start", (event: unknown) => {
    return { handled: true, event };
  });

  api.registerService({
    id: "test-service",
    start: async () => {
      /* noop */
    },
    stop: async () => {
      /* noop */
    },
  });

  api.registerCommand({
    name: "test-cmd",
    description: "A test command",
    handler: async (args: string[]) => {
      return { text: `executed with ${args.length} args` };
    },
  });
}
