/**
 * Message type definitions for main↔worker communication.
 */

// --- Init ---
export type WorkerInitMessage = {
  type: "init";
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
};

// --- Registration (worker → main) ---

export type RegisterToolMessage = {
  type: "register:tool";
  descriptor: SerializedToolDescriptor;
};

export type RegisterHookMessage = {
  type: "register:hook";
  hookName: string;
  handlerId: string;
  priority?: number;
};

export type RegisterServiceMessage = {
  type: "register:service";
  serviceId: string;
};

export type RegisterCommandMessage = {
  type: "register:command";
  name: string;
  description?: string;
  usage?: string;
};

export type RegistrationCompleteMessage = {
  type: "registration:complete";
};

export type RegistrationErrorMessage = {
  type: "registration:error";
  error: string;
};

export type UnsupportedApiMessage = {
  type: "unsupported:api";
  method: string;
  error: string;
};

// --- Invocation (main → worker) ---

export type InvokeToolMessage = {
  type: "invoke:tool";
  reqId: string;
  toolName: string;
  args: Record<string, unknown>;
};

export type InvokeHookMessage = {
  type: "invoke:hook";
  reqId: string;
  hookName: string;
  handlerId: string;
  event: unknown;
};

export type InvokeServiceStartMessage = {
  type: "invoke:service:start";
  reqId: string;
  serviceId: string;
};

export type InvokeServiceStopMessage = {
  type: "invoke:service:stop";
  reqId: string;
  serviceId: string;
};

export type InvokeCommandMessage = {
  type: "invoke:command";
  reqId: string;
  commandName: string;
  args: string[];
  context: {
    channelId?: string;
    senderId?: string;
  };
};

// --- Response (worker → main) ---

export type InvokeResultMessage = {
  type: "invoke:result";
  reqId: string;
  ok: boolean;
  value?: unknown;
  error?: string;
};

// --- Logging (worker → main) ---

export type LogMessage = {
  type: "log";
  level: "info" | "warn" | "error" | "debug";
  message: string;
  args?: unknown[];
};

// --- Tool descriptor (serializable subset) ---

export type SerializedToolDescriptor = {
  name: string;
  label?: string;
  description?: string;
  parameters?: Record<string, unknown>;
};

// --- Union types ---

export type WorkerToMainMessage =
  | RegisterToolMessage
  | RegisterHookMessage
  | RegisterServiceMessage
  | RegisterCommandMessage
  | RegistrationCompleteMessage
  | RegistrationErrorMessage
  | UnsupportedApiMessage
  | InvokeResultMessage
  | LogMessage;

export type MainToWorkerMessage =
  | WorkerInitMessage
  | InvokeToolMessage
  | InvokeHookMessage
  | InvokeServiceStartMessage
  | InvokeServiceStopMessage
  | InvokeCommandMessage;

// --- Type guards ---

export function isWorkerToMainMessage(data: unknown): data is WorkerToMainMessage {
  return (
    data !== null &&
    typeof data === "object" &&
    typeof (data as Record<string, unknown>).type === "string"
  );
}

export function isMainToWorkerMessage(data: unknown): data is MainToWorkerMessage {
  return (
    data !== null &&
    typeof data === "object" &&
    typeof (data as Record<string, unknown>).type === "string"
  );
}
