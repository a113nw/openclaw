/**
 * Worker Thread entry point — runs inside the Worker.
 *
 * Receives init message, creates bridge API, loads plugin via Jiti,
 * calls register(bridgeApi), and handles invocation messages.
 */
import { parentPort } from "node:worker_threads";
import { createJiti } from "jiti";
import type {
  WorkerInitMessage,
  MainToWorkerMessage,
  InvokeResultMessage,
  LogMessage,
  SerializedToolDescriptor,
} from "./protocol.js";
import { serializeToolDescriptor } from "./serialization.js";

if (!parentPort) {
  throw new Error("worker-entry must be run inside a Worker Thread");
}

const port = parentPort;

// Handler storage
const toolHandlers = new Map<string, (args: Record<string, unknown>) => unknown>();
const hookHandlers = new Map<string, (event: unknown) => unknown>();
const serviceHandlers = new Map<
  string,
  { start?: () => unknown; stop?: () => unknown }
>();
const commandHandlers = new Map<
  string,
  (args: string[], context: Record<string, unknown>) => unknown
>();

// Unsupported API methods — throw clear errors
const UNSUPPORTED_METHODS = [
  "registerChannel",
  "registerProvider",
  "registerHttpHandler",
  "registerHttpRoute",
  "registerGatewayMethod",
  "registerCli",
] as const;

function sendLog(level: LogMessage["level"], message: string, args?: unknown[]) {
  port.postMessage({ type: "log", level, message, args } satisfies LogMessage);
}

function createBridgeApi(init: WorkerInitMessage) {
  const unsupported: Record<string, () => never> = {};
  for (const method of UNSUPPORTED_METHODS) {
    unsupported[method] = () => {
      const error = `${method} is not supported in isolated (worker) mode`;
      port.postMessage({ type: "unsupported:api", method, error });
      throw new Error(error);
    };
  }

  return {
    id: init.metadata.id,
    name: init.metadata.name,
    version: init.metadata.version,
    description: init.metadata.description,
    source: init.pluginSource,
    config: {},
    pluginConfig: init.pluginConfig,
    get runtime(): never {
      throw new Error("api.runtime is not available in isolated mode");
    },
    logger: {
      info: (msg: string, ...args: unknown[]) => sendLog("info", msg, args),
      warn: (msg: string, ...args: unknown[]) => sendLog("warn", msg, args),
      error: (msg: string, ...args: unknown[]) => sendLog("error", msg, args),
      debug: (msg: string, ...args: unknown[]) => sendLog("debug", msg, args),
    },

    registerTool(tool: Record<string, unknown>, opts?: { name?: string }) {
      const descriptor = serializeToolDescriptor(tool);
      const name = opts?.name || descriptor.name;
      if (!name) {
        sendLog("error", "registerTool: missing tool name");
        return;
      }
      descriptor.name = name;

      // Store the execute handler locally
      if (typeof tool.execute === "function") {
        toolHandlers.set(name, tool.execute as (args: Record<string, unknown>) => unknown);
      }

      port.postMessage({ type: "register:tool", descriptor });
    },

    registerHook(
      _events: string | string[],
      _handler: unknown,
      _opts?: Record<string, unknown>,
    ) {
      sendLog("warn", "registerHook via legacy API is not supported in worker mode; use on() instead");
    },

    registerService(service: { id: string; start?: () => unknown; stop?: () => unknown }) {
      const id = service.id?.trim();
      if (!id) return;
      serviceHandlers.set(id, { start: service.start, stop: service.stop });
      port.postMessage({ type: "register:service", serviceId: id });
    },

    registerCommand(command: {
      name: string;
      description?: string;
      usage?: string;
      handler: (args: string[], context: Record<string, unknown>) => unknown;
    }) {
      const name = command.name?.trim();
      if (!name) return;
      commandHandlers.set(name, command.handler);
      port.postMessage({
        type: "register:command",
        name,
        description: command.description,
        usage: command.usage,
      });
    },

    on(hookName: string, handler: (event: unknown) => unknown, opts?: { priority?: number }) {
      const handlerId = `${init.pluginId}:${hookName}`;
      hookHandlers.set(handlerId, handler);
      port.postMessage({
        type: "register:hook",
        hookName,
        handlerId,
        priority: opts?.priority,
      });
    },

    resolvePath: (input: string) => input,

    // Unsupported methods
    ...unsupported,
  };
}

async function handleInvocation(msg: MainToWorkerMessage): Promise<void> {
  if (msg.type === "invoke:tool") {
    const handler = toolHandlers.get(msg.toolName);
    if (!handler) {
      port.postMessage({
        type: "invoke:result",
        reqId: msg.reqId,
        ok: false,
        error: `tool not found: ${msg.toolName}`,
      } satisfies InvokeResultMessage);
      return;
    }
    try {
      const value = await handler(msg.args);
      port.postMessage({
        type: "invoke:result",
        reqId: msg.reqId,
        ok: true,
        value,
      } satisfies InvokeResultMessage);
    } catch (err) {
      port.postMessage({
        type: "invoke:result",
        reqId: msg.reqId,
        ok: false,
        error: String(err),
      } satisfies InvokeResultMessage);
    }
    return;
  }

  if (msg.type === "invoke:hook") {
    const handler = hookHandlers.get(msg.handlerId);
    if (!handler) {
      port.postMessage({
        type: "invoke:result",
        reqId: msg.reqId,
        ok: true,
        value: undefined,
      } satisfies InvokeResultMessage);
      return;
    }
    try {
      const value = await handler(msg.event);
      port.postMessage({
        type: "invoke:result",
        reqId: msg.reqId,
        ok: true,
        value,
      } satisfies InvokeResultMessage);
    } catch (err) {
      port.postMessage({
        type: "invoke:result",
        reqId: msg.reqId,
        ok: false,
        error: String(err),
      } satisfies InvokeResultMessage);
    }
    return;
  }

  if (msg.type === "invoke:service:start") {
    const svc = serviceHandlers.get(msg.serviceId);
    try {
      await svc?.start?.();
      port.postMessage({
        type: "invoke:result",
        reqId: msg.reqId,
        ok: true,
      } satisfies InvokeResultMessage);
    } catch (err) {
      port.postMessage({
        type: "invoke:result",
        reqId: msg.reqId,
        ok: false,
        error: String(err),
      } satisfies InvokeResultMessage);
    }
    return;
  }

  if (msg.type === "invoke:service:stop") {
    const svc = serviceHandlers.get(msg.serviceId);
    try {
      await svc?.stop?.();
      port.postMessage({
        type: "invoke:result",
        reqId: msg.reqId,
        ok: true,
      } satisfies InvokeResultMessage);
    } catch (err) {
      port.postMessage({
        type: "invoke:result",
        reqId: msg.reqId,
        ok: false,
        error: String(err),
      } satisfies InvokeResultMessage);
    }
    return;
  }

  if (msg.type === "invoke:command") {
    const handler = commandHandlers.get(msg.commandName);
    if (!handler) {
      port.postMessage({
        type: "invoke:result",
        reqId: msg.reqId,
        ok: false,
        error: `command not found: ${msg.commandName}`,
      } satisfies InvokeResultMessage);
      return;
    }
    try {
      const value = await handler(msg.args, msg.context);
      port.postMessage({
        type: "invoke:result",
        reqId: msg.reqId,
        ok: true,
        value,
      } satisfies InvokeResultMessage);
    } catch (err) {
      port.postMessage({
        type: "invoke:result",
        reqId: msg.reqId,
        ok: false,
        error: String(err),
      } satisfies InvokeResultMessage);
    }
    return;
  }
}

// Main message loop
port.on("message", async (msg: MainToWorkerMessage) => {
  if (msg.type === "init") {
    const init = msg as WorkerInitMessage;
    const api = createBridgeApi(init);

    try {
      // Create Jiti loader
      const alias = init.jitiAlias ?? {};
      const jiti = createJiti(init.pluginSource, {
        interopDefault: true,
        extensions: [".ts", ".tsx", ".mts", ".cts", ".mtsx", ".ctsx", ".js", ".mjs", ".cjs", ".json"],
        ...(Object.keys(alias).length > 0 ? { alias } : {}),
      });

      // Load plugin module
      const mod = jiti(init.pluginSource) as Record<string, unknown>;

      // Resolve register function
      const resolved =
        mod && typeof mod === "object" && "default" in mod ? mod.default : mod;
      const register =
        typeof resolved === "function"
          ? (resolved as (api: unknown) => void)
          : typeof (resolved as Record<string, unknown>)?.register === "function"
            ? ((resolved as Record<string, unknown>).register as (api: unknown) => void)
            : typeof (resolved as Record<string, unknown>)?.activate === "function"
              ? ((resolved as Record<string, unknown>).activate as (api: unknown) => void)
              : null;

      if (!register) {
        port.postMessage({
          type: "registration:error",
          error: "plugin module missing register/activate export",
        });
        return;
      }

      register(api);
      port.postMessage({ type: "registration:complete" });
    } catch (err) {
      port.postMessage({
        type: "registration:error",
        error: String(err),
      });
    }
    return;
  }

  await handleInvocation(msg);
});
