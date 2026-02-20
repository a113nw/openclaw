/**
 * Main-thread side of a Worker Thread isolated plugin.
 *
 * Creates Worker, sends init, listens for registrations, and proxies invocations.
 */
import fs from "node:fs";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type {
  WorkerInitMessage,
  WorkerToMainMessage,
  InvokeResultMessage,
  SerializedToolDescriptor,
} from "./protocol.js";
import { isWorkerToMainMessage } from "./protocol.js";
import { RpcCorrelator } from "./rpc.js";

// Timeouts
const REGISTRATION_TIMEOUT_MS = 10_000;
const TOOL_INVOKE_TIMEOUT_MS = 60_000;
const HOOK_INVOKE_TIMEOUT_MS = 5_000;
const SERVICE_START_TIMEOUT_MS = 30_000;
const SERVICE_STOP_TIMEOUT_MS = 5_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

export type WorkerHostParams = {
  pluginId: string;
  pluginSource: string;
  pluginConfig?: Record<string, unknown>;
  metadata: {
    id: string;
    name: string;
    version?: string;
    description?: string;
  };
  jitiAlias?: Record<string, string>;
  logger: {
    info: (msg: string, ...args: unknown[]) => void;
    warn: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
    debug: (msg: string, ...args: unknown[]) => void;
  };
  onRegisterTool?: (descriptor: SerializedToolDescriptor) => void;
  onRegisterHook?: (hookName: string, handlerId: string, priority?: number) => void;
  onRegisterService?: (serviceId: string) => void;
  onRegisterCommand?: (name: string, description?: string, usage?: string) => void;
};

export type WorkerHost = {
  pluginId: string;
  worker: Worker;
  ready: Promise<void>;
  invokeTool: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
  invokeHook: (hookName: string, handlerId: string, event: unknown) => Promise<unknown>;
  invokeServiceStart: (serviceId: string) => Promise<void>;
  invokeServiceStop: (serviceId: string) => Promise<void>;
  invokeCommand: (
    commandName: string,
    args: string[],
    context: { channelId?: string; senderId?: string },
  ) => Promise<unknown>;
  terminate: () => Promise<void>;
};

function resolveWorkerEntryPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const dir = path.dirname(thisFile);
  const jsPath = path.join(dir, "worker-entry.js");
  if (fs.existsSync(jsPath)) return jsPath;
  return path.join(dir, "worker-entry.ts");
}

function createWorkerInstance(entryPath: string): Worker {
  // Production: compiled .js files can be loaded directly
  if (entryPath.endsWith(".js")) {
    return new Worker(entryPath);
  }
  // Dev/test: TypeScript files need jiti bootstrapping
  const bootstrap = [
    `const { workerData } = require('node:worker_threads');`,
    `(async () => {`,
    `  const { createJiti } = await import('jiti');`,
    `  const jiti = createJiti(workerData.entryPath, { interopDefault: true });`,
    `  await jiti.import(workerData.entryPath, { default: true });`,
    `})().catch(err => {`,
    `  const { parentPort } = require('node:worker_threads');`,
    `  if (parentPort) parentPort.postMessage({ type: 'registration:error', error: String(err) });`,
    `});`,
  ].join("\n");
  return new Worker(bootstrap, { eval: true, workerData: { entryPath } });
}

export function createWorkerHost(params: WorkerHostParams): WorkerHost {
  const rpc = new RpcCorrelator();
  const workerPath = resolveWorkerEntryPath();

  const worker = createWorkerInstance(workerPath);
  let terminated = false;

  let readyResolve: () => void;
  let readyReject: (err: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  // Registration timeout
  const registrationTimer = setTimeout(() => {
    readyReject(new Error(`plugin ${params.pluginId} registration timed out after ${REGISTRATION_TIMEOUT_MS}ms`));
  }, REGISTRATION_TIMEOUT_MS);

  // Handle messages from Worker
  worker.on("message", (msg: unknown) => {
    if (!isWorkerToMainMessage(msg)) return;
    const message = msg as WorkerToMainMessage;

    switch (message.type) {
      case "registration:complete":
        clearTimeout(registrationTimer);
        readyResolve();
        break;

      case "registration:error":
        clearTimeout(registrationTimer);
        readyReject(new Error(`plugin ${params.pluginId} registration failed: ${message.error}`));
        break;

      case "register:tool":
        params.onRegisterTool?.(message.descriptor);
        break;

      case "register:hook":
        params.onRegisterHook?.(message.hookName, message.handlerId, message.priority);
        break;

      case "register:service":
        params.onRegisterService?.(message.serviceId);
        break;

      case "register:command":
        params.onRegisterCommand?.(message.name, message.description, message.usage);
        break;

      case "invoke:result": {
        const result = message as InvokeResultMessage;
        if (result.ok) {
          rpc.resolve(result.reqId, result.value);
        } else {
          rpc.reject(result.reqId, new Error(result.error ?? "unknown worker error"));
        }
        break;
      }

      case "log":
        switch (message.level) {
          case "info":
            params.logger.info(`[worker:${params.pluginId}] ${message.message}`, ...(message.args ?? []));
            break;
          case "warn":
            params.logger.warn(`[worker:${params.pluginId}] ${message.message}`, ...(message.args ?? []));
            break;
          case "error":
            params.logger.error(`[worker:${params.pluginId}] ${message.message}`, ...(message.args ?? []));
            break;
          case "debug":
            params.logger.debug(`[worker:${params.pluginId}] ${message.message}`, ...(message.args ?? []));
            break;
        }
        break;

      case "unsupported:api":
        params.logger.warn(
          `[worker:${params.pluginId}] unsupported API call: ${message.method} — ${message.error}`,
        );
        break;
    }
  });

  // Handle Worker errors
  worker.on("error", (err: unknown) => {
    clearTimeout(registrationTimer);
    readyReject(err instanceof Error ? err : new Error(String(err)));
    rpc.rejectAll(new Error(`worker crashed: ${String(err)}`));
  });

  worker.on("exit", (code) => {
    if (code !== 0) {
      const err = new Error(`worker exited with code ${code}`);
      readyReject(err);
      rpc.rejectAll(err);
    }
  });

  // Send init message
  const initMsg: WorkerInitMessage = {
    type: "init",
    pluginId: params.pluginId,
    pluginSource: params.pluginSource,
    pluginConfig: params.pluginConfig,
    metadata: params.metadata,
    jitiAlias: params.jitiAlias,
  };
  worker.postMessage(initMsg);

  return {
    pluginId: params.pluginId,
    worker,
    ready,

    async invokeTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
      if (terminated) throw new Error("worker terminated");
      await ready;
      const { reqId, promise } = rpc.createRequest(TOOL_INVOKE_TIMEOUT_MS);
      worker.postMessage({ type: "invoke:tool", reqId, toolName, args });
      return promise;
    },

    async invokeHook(hookName: string, handlerId: string, event: unknown): Promise<unknown> {
      if (terminated) throw new Error("worker terminated");
      await ready;
      const { reqId, promise } = rpc.createRequest(HOOK_INVOKE_TIMEOUT_MS);
      worker.postMessage({ type: "invoke:hook", reqId, hookName, handlerId, event });
      return promise;
    },

    async invokeServiceStart(serviceId: string): Promise<void> {
      if (terminated) throw new Error("worker terminated");
      await ready;
      const { reqId, promise } = rpc.createRequest(SERVICE_START_TIMEOUT_MS);
      worker.postMessage({ type: "invoke:service:start", reqId, serviceId });
      await promise;
    },

    async invokeServiceStop(serviceId: string): Promise<void> {
      if (terminated) throw new Error("worker terminated");
      await ready;
      const { reqId, promise } = rpc.createRequest(SERVICE_STOP_TIMEOUT_MS);
      worker.postMessage({ type: "invoke:service:stop", reqId, serviceId });
      await promise;
    },

    async invokeCommand(
      commandName: string,
      args: string[],
      context: { channelId?: string; senderId?: string },
    ): Promise<unknown> {
      if (terminated) throw new Error("worker terminated");
      await ready;
      const { reqId, promise } = rpc.createRequest(TOOL_INVOKE_TIMEOUT_MS);
      worker.postMessage({ type: "invoke:command", reqId, commandName, args, context });
      return promise;
    },

    async terminate(): Promise<void> {
      if (terminated) return;
      terminated = true;
      rpc.rejectAll(new Error("worker terminated"));
      const exitPromise = new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), SHUTDOWN_TIMEOUT_MS);
        worker.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      await worker.terminate();
      await exitPromise;
    },
  };
}
