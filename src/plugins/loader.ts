import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import type { OpenClawConfig } from "../config/config.js";
import type { GatewayRequestHandler } from "../gateway/server-methods/types.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveUserPath } from "../utils.js";
import { clearPluginCommands } from "./commands.js";
import {
  applyTestPluginDefaults,
  normalizePluginsConfig,
  resolveEnableState,
  resolveMemorySlotDecision,
  type NormalizedPluginsConfig,
} from "./config-state.js";
import { discoverOpenClawPlugins } from "./discovery.js";
import { initializeGlobalHookRunner } from "./hook-runner-global.js";
import { loadPluginManifestRegistry } from "./manifest-registry.js";
import {
  createRestrictedPluginApi,
  type PluginCapability,
} from "../security/plugin-capabilities.js";
import { createWorkerHost, type WorkerHost } from "../security/worker-bridge/main-host.js";
import { createPluginRegistry, type PluginRecord, type PluginRegistry } from "./registry.js";
import { setActivePluginRegistry } from "./runtime.js";
import { createPluginRuntime } from "./runtime/index.js";
import { validateJsonSchemaValue } from "./schema-validator.js";
import type {
  AnyAgentTool,
  OpenClawPluginDefinition,
  OpenClawPluginModule,
  OpenClawPluginToolFactory,
  PluginDiagnostic,
  PluginHookRegistration as TypedPluginHookRegistration,
  PluginLogger,
} from "./types.js";

export type PluginLoadResult = PluginRegistry;

export type PluginLoadOptions = {
  config?: OpenClawConfig;
  workspaceDir?: string;
  logger?: PluginLogger;
  coreGatewayHandlers?: Record<string, GatewayRequestHandler>;
  cache?: boolean;
  mode?: "full" | "validate";
};

const registryCache = new Map<string, PluginRegistry>();
const activeWorkers: WorkerHost[] = [];

const defaultLogger = () => createSubsystemLogger("plugins");

const resolvePluginSdkAliasFile = (params: {
  srcFile: string;
  distFile: string;
}): string | null => {
  try {
    const modulePath = fileURLToPath(import.meta.url);
    const isProduction = process.env.NODE_ENV === "production";
    const isTest = process.env.VITEST || process.env.NODE_ENV === "test";
    let cursor = path.dirname(modulePath);
    for (let i = 0; i < 6; i += 1) {
      const srcCandidate = path.join(cursor, "src", "plugin-sdk", params.srcFile);
      const distCandidate = path.join(cursor, "dist", "plugin-sdk", params.distFile);
      const orderedCandidates = isProduction
        ? isTest
          ? [distCandidate, srcCandidate]
          : [distCandidate]
        : [srcCandidate, distCandidate];
      for (const candidate of orderedCandidates) {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        break;
      }
      cursor = parent;
    }
  } catch {
    // ignore
  }
  return null;
};

const resolvePluginSdkAlias = (): string | null =>
  resolvePluginSdkAliasFile({ srcFile: "index.ts", distFile: "index.js" });

const resolvePluginSdkAccountIdAlias = (): string | null => {
  return resolvePluginSdkAliasFile({ srcFile: "account-id.ts", distFile: "account-id.js" });
};

function buildCacheKey(params: {
  workspaceDir?: string;
  plugins: NormalizedPluginsConfig;
}): string {
  const workspaceKey = params.workspaceDir ? resolveUserPath(params.workspaceDir) : "";
  return `${workspaceKey}::${JSON.stringify(params.plugins)}`;
}

function validatePluginConfig(params: {
  schema?: Record<string, unknown>;
  cacheKey?: string;
  value?: unknown;
}): { ok: boolean; value?: Record<string, unknown>; errors?: string[] } {
  const schema = params.schema;
  if (!schema) {
    return { ok: true, value: params.value as Record<string, unknown> | undefined };
  }
  const cacheKey = params.cacheKey ?? JSON.stringify(schema);
  const result = validateJsonSchemaValue({
    schema,
    cacheKey,
    value: params.value ?? {},
  });
  if (result.ok) {
    return { ok: true, value: params.value as Record<string, unknown> | undefined };
  }
  return { ok: false, errors: result.errors };
}

function resolvePluginModuleExport(moduleExport: unknown): {
  definition?: OpenClawPluginDefinition;
  register?: OpenClawPluginDefinition["register"];
} {
  const resolved =
    moduleExport &&
    typeof moduleExport === "object" &&
    "default" in (moduleExport as Record<string, unknown>)
      ? (moduleExport as { default: unknown }).default
      : moduleExport;
  if (typeof resolved === "function") {
    return {
      register: resolved as OpenClawPluginDefinition["register"],
    };
  }
  if (resolved && typeof resolved === "object") {
    const def = resolved as OpenClawPluginDefinition;
    const register = def.register ?? def.activate;
    return { definition: def, register };
  }
  return {};
}

function createPluginRecord(params: {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  source: string;
  origin: PluginRecord["origin"];
  workspaceDir?: string;
  enabled: boolean;
  configSchema: boolean;
  signed?: boolean;
  signatureKeyId?: string;
}): PluginRecord {
  return {
    id: params.id,
    name: params.name ?? params.id,
    description: params.description,
    version: params.version,
    source: params.source,
    origin: params.origin,
    workspaceDir: params.workspaceDir,
    enabled: params.enabled,
    status: params.enabled ? "loaded" : "disabled",
    toolNames: [],
    hookNames: [],
    channelIds: [],
    providerIds: [],
    gatewayMethods: [],
    cliCommands: [],
    services: [],
    commands: [],
    httpHandlers: 0,
    hookCount: 0,
    configSchema: params.configSchema,
    configUiHints: undefined,
    configJsonSchema: undefined,
    signed: params.signed,
    signatureKeyId: params.signatureKeyId,
  };
}

function pushDiagnostics(diagnostics: PluginDiagnostic[], append: PluginDiagnostic[]) {
  diagnostics.push(...append);
}

export function loadOpenClawPlugins(options: PluginLoadOptions = {}): PluginRegistry {
  // Test env: default-disable plugins unless explicitly configured.
  // This keeps unit/gateway suites fast and avoids loading heavyweight plugin deps by accident.
  const cfg = applyTestPluginDefaults(options.config ?? {}, process.env);
  const logger = options.logger ?? defaultLogger();
  const validateOnly = options.mode === "validate";
  const normalized = normalizePluginsConfig(cfg.plugins);
  const cacheKey = buildCacheKey({
    workspaceDir: options.workspaceDir,
    plugins: normalized,
  });
  const cacheEnabled = options.cache !== false;
  if (cacheEnabled) {
    const cached = registryCache.get(cacheKey);
    if (cached) {
      setActivePluginRegistry(cached, cacheKey);
      return cached;
    }
  }

  // Clear previously registered plugin commands before reloading
  clearPluginCommands();

  const runtime = createPluginRuntime();
  const { registry, createApi } = createPluginRegistry({
    logger,
    runtime,
    coreGatewayHandlers: options.coreGatewayHandlers as Record<string, GatewayRequestHandler>,
  });

  const discovery = discoverOpenClawPlugins({
    workspaceDir: options.workspaceDir,
    extraPaths: normalized.loadPaths,
  });
  const manifestRegistry = loadPluginManifestRegistry({
    config: cfg,
    workspaceDir: options.workspaceDir,
    cache: options.cache,
    candidates: discovery.candidates,
    diagnostics: discovery.diagnostics,
  });
  pushDiagnostics(registry.diagnostics, manifestRegistry.diagnostics);

  // Lazy: avoid creating the Jiti loader when all plugins are disabled (common in unit tests).
  let jitiLoader: ReturnType<typeof createJiti> | null = null;
  const getJiti = () => {
    if (jitiLoader) {
      return jitiLoader;
    }
    const pluginSdkAlias = resolvePluginSdkAlias();
    const pluginSdkAccountIdAlias = resolvePluginSdkAccountIdAlias();
    jitiLoader = createJiti(import.meta.url, {
      interopDefault: true,
      extensions: [".ts", ".tsx", ".mts", ".cts", ".mtsx", ".ctsx", ".js", ".mjs", ".cjs", ".json"],
      ...(pluginSdkAlias || pluginSdkAccountIdAlias
        ? {
            alias: {
              ...(pluginSdkAlias ? { "openclaw/plugin-sdk": pluginSdkAlias } : {}),
              ...(pluginSdkAccountIdAlias
                ? { "openclaw/plugin-sdk/account-id": pluginSdkAccountIdAlias }
                : {}),
            },
          }
        : {}),
    });
    return jitiLoader;
  };

  const manifestByRoot = new Map(
    manifestRegistry.plugins.map((record) => [record.rootDir, record]),
  );

  const seenIds = new Map<string, PluginRecord["origin"]>();
  const isolatedWorkers: WorkerHost[] = [];
  const memorySlot = normalized.slots.memory;
  let selectedMemoryPluginId: string | null = null;
  let memorySlotMatched = false;

  for (const candidate of discovery.candidates) {
    const manifestRecord = manifestByRoot.get(candidate.rootDir);
    if (!manifestRecord) {
      continue;
    }
    const pluginId = manifestRecord.id;
    const existingOrigin = seenIds.get(pluginId);
    if (existingOrigin) {
      const record = createPluginRecord({
        id: pluginId,
        name: manifestRecord.name ?? pluginId,
        description: manifestRecord.description,
        version: manifestRecord.version,
        source: candidate.source,
        origin: candidate.origin,
        workspaceDir: candidate.workspaceDir,
        enabled: false,
        configSchema: Boolean(manifestRecord.configSchema),
        signed: manifestRecord.signed,
        signatureKeyId: manifestRecord.signatureKeyId,
      });
      record.status = "disabled";
      record.error = `overridden by ${existingOrigin} plugin`;
      registry.plugins.push(record);
      continue;
    }

    const enableState = resolveEnableState(pluginId, candidate.origin, normalized);
    const entry = normalized.entries[pluginId];
    const record = createPluginRecord({
      id: pluginId,
      name: manifestRecord.name ?? pluginId,
      description: manifestRecord.description,
      version: manifestRecord.version,
      source: candidate.source,
      origin: candidate.origin,
      workspaceDir: candidate.workspaceDir,
      enabled: enableState.enabled,
      configSchema: Boolean(manifestRecord.configSchema),
      signed: manifestRecord.signed,
      signatureKeyId: manifestRecord.signatureKeyId,
    });
    record.kind = manifestRecord.kind;
    record.isolation = manifestRecord.isolation;
    record.configUiHints = manifestRecord.configUiHints;
    record.configJsonSchema = manifestRecord.configSchema;

    if (!enableState.enabled) {
      record.status = "disabled";
      record.error = enableState.reason;
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      continue;
    }

    if (!manifestRecord.configSchema) {
      record.status = "error";
      record.error = "missing config schema";
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      registry.diagnostics.push({
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: record.error,
      });
      continue;
    }

    let mod: OpenClawPluginModule | null = null;
    try {
      mod = getJiti()(candidate.source) as OpenClawPluginModule;
    } catch (err) {
      logger.error(`[plugins] ${record.id} failed to load from ${record.source}: ${String(err)}`);
      record.status = "error";
      record.error = String(err);
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      registry.diagnostics.push({
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: `failed to load plugin: ${String(err)}`,
      });
      continue;
    }

    const resolved = resolvePluginModuleExport(mod);
    const definition = resolved.definition;
    const register = resolved.register;

    if (definition?.id && definition.id !== record.id) {
      registry.diagnostics.push({
        level: "warn",
        pluginId: record.id,
        source: record.source,
        message: `plugin id mismatch (config uses "${record.id}", export uses "${definition.id}")`,
      });
    }

    record.name = definition?.name ?? record.name;
    record.description = definition?.description ?? record.description;
    record.version = definition?.version ?? record.version;
    const manifestKind = record.kind as string | undefined;
    const exportKind = definition?.kind as string | undefined;
    if (manifestKind && exportKind && exportKind !== manifestKind) {
      registry.diagnostics.push({
        level: "warn",
        pluginId: record.id,
        source: record.source,
        message: `plugin kind mismatch (manifest uses "${manifestKind}", export uses "${exportKind}")`,
      });
    }
    record.kind = definition?.kind ?? record.kind;

    if (record.kind === "memory" && memorySlot === record.id) {
      memorySlotMatched = true;
    }

    const memoryDecision = resolveMemorySlotDecision({
      id: record.id,
      kind: record.kind,
      slot: memorySlot,
      selectedId: selectedMemoryPluginId,
    });

    if (!memoryDecision.enabled) {
      record.enabled = false;
      record.status = "disabled";
      record.error = memoryDecision.reason;
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      continue;
    }

    if (memoryDecision.selected && record.kind === "memory") {
      selectedMemoryPluginId = record.id;
    }

    const validatedConfig = validatePluginConfig({
      schema: manifestRecord.configSchema,
      cacheKey: manifestRecord.schemaCacheKey,
      value: entry?.config,
    });

    if (!validatedConfig.ok) {
      logger.error(`[plugins] ${record.id} invalid config: ${validatedConfig.errors?.join(", ")}`);
      record.status = "error";
      record.error = `invalid config: ${validatedConfig.errors?.join(", ")}`;
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      registry.diagnostics.push({
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: record.error,
      });
      continue;
    }

    if (validateOnly) {
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      continue;
    }

    // Worker Thread isolation: load plugin in isolated Worker instead of in-process
    if (manifestRecord.isolation === "worker") {
      try {
        const pluginSdkAlias = resolvePluginSdkAlias();
        const pluginSdkAccountIdAlias = resolvePluginSdkAccountIdAlias();
        const jitiAlias: Record<string, string> = {};
        if (pluginSdkAlias) jitiAlias["openclaw/plugin-sdk"] = pluginSdkAlias;
        if (pluginSdkAccountIdAlias) jitiAlias["openclaw/plugin-sdk/account-id"] = pluginSdkAccountIdAlias;

        const workerHost = createWorkerHost({
          pluginId: record.id,
          pluginSource: candidate.source,
          pluginConfig: validatedConfig.value,
          metadata: {
            id: record.id,
            name: record.name,
            version: record.version,
            description: record.description,
          },
          jitiAlias,
          logger: {
            info: (msg: string) => logger.info(msg),
            warn: (msg: string) => logger.warn(msg),
            error: (msg: string) => logger.error(msg),
            debug: (msg: string) => logger.debug?.(msg),
          },
          onRegisterTool: (descriptor) => {
            record.toolNames.push(descriptor.name);
            const proxyFactory: OpenClawPluginToolFactory = () =>
              ({
                name: descriptor.name,
                description: descriptor.description ?? "",
                parameters: descriptor.parameters ?? {},
                async execute(_toolCallId: string, params: unknown) {
                  const result = await workerHost.invokeTool(
                    descriptor.name,
                    (params ?? {}) as Record<string, unknown>,
                  );
                  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
                },
              }) as AnyAgentTool;
            registry.tools.push({
              pluginId: record.id,
              factory: proxyFactory,
              names: [descriptor.name],
              optional: false,
              source: record.source,
            });
          },
          onRegisterHook: (hookName, handlerId, priority) => {
            record.hookCount += 1;
            registry.typedHooks.push({
              pluginId: record.id,
              hookName,
              handler: async (event: unknown) => {
                return workerHost.invokeHook(hookName, handlerId, event);
              },
              priority,
              source: record.source,
            } as TypedPluginHookRegistration);
          },
          onRegisterService: (serviceId) => {
            record.services.push(serviceId);
            registry.services.push({
              pluginId: record.id,
              service: {
                id: serviceId,
                start: async () => workerHost.invokeServiceStart(serviceId),
                stop: async () => workerHost.invokeServiceStop(serviceId),
              },
              source: record.source,
            });
          },
          onRegisterCommand: (name, description) => {
            record.commands.push(name);
            registry.commands.push({
              pluginId: record.id,
              command: {
                name,
                description: description ?? "",
                handler: async (ctx) => {
                  const args = ctx.args ? ctx.args.split(/\s+/).filter(Boolean) : [];
                  const result = await workerHost.invokeCommand(name, args, {
                    channelId: ctx.channelId,
                    senderId: ctx.senderId,
                  });
                  return result as { text?: string };
                },
              },
              source: record.source,
            });
          },
        });

        isolatedWorkers.push(workerHost);
        registry.plugins.push(record);
        seenIds.set(pluginId, candidate.origin);
      } catch (err) {
        logger.error(`[plugins] ${record.id} failed to create worker: ${String(err)}`);
        record.status = "error";
        record.error = String(err);
        registry.plugins.push(record);
        seenIds.set(pluginId, candidate.origin);
        registry.diagnostics.push({
          level: "error",
          pluginId: record.id,
          source: record.source,
          message: `failed to create worker: ${String(err)}`,
        });
      }
      continue;
    }

    if (typeof register !== "function") {
      logger.error(`[plugins] ${record.id} missing register/activate export`);
      record.status = "error";
      record.error = "plugin export missing register/activate";
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      registry.diagnostics.push({
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: record.error,
      });
      continue;
    }

    const rawApi = createApi(record, {
      config: cfg,
      pluginConfig: validatedConfig.value,
    });
    // If the plugin definition declares capabilities, enforce them.
    const declaredCapabilities = (
      definition as { capabilities?: PluginCapability[] }
    )?.capabilities;
    const api = declaredCapabilities
      ? createRestrictedPluginApi(rawApi, declaredCapabilities)
      : rawApi;

    try {
      const result = register(api);
      if (result && typeof result.then === "function") {
        registry.diagnostics.push({
          level: "warn",
          pluginId: record.id,
          source: record.source,
          message: "plugin register returned a promise; async registration is ignored",
        });
      }
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
    } catch (err) {
      logger.error(
        `[plugins] ${record.id} failed during register from ${record.source}: ${String(err)}`,
      );
      record.status = "error";
      record.error = String(err);
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      registry.diagnostics.push({
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: `plugin failed during register: ${String(err)}`,
      });
    }
  }

  if (typeof memorySlot === "string" && !memorySlotMatched) {
    registry.diagnostics.push({
      level: "warn",
      message: `memory slot plugin not found or not marked as memory: ${memorySlot}`,
    });
  }

  // Track isolated workers for finalization
  activeWorkers.push(...isolatedWorkers);

  if (cacheEnabled) {
    registryCache.set(cacheKey, registry);
  }
  setActivePluginRegistry(registry, cacheKey);
  initializeGlobalHookRunner(registry);
  return registry;
}

/**
 * Finalize isolated plugins — wait for all Worker registrations to complete.
 * Call after loadOpenClawPlugins() to ensure worker-based plugins are ready.
 */
export async function finalizeIsolatedPlugins(registry: PluginRegistry): Promise<void> {
  const workers = activeWorkers.filter((w) =>
    registry.plugins.some((p) => p.id === w.pluginId && p.status === "loaded"),
  );
  const results = await Promise.allSettled(workers.map((w) => w.ready));
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result && result.status === "rejected") {
      const worker = workers[i];
      if (worker) {
        const plugin = registry.plugins.find((p) => p.id === worker.pluginId);
        if (plugin) {
          plugin.status = "error";
          plugin.error = String(result.reason);
        }
        registry.diagnostics.push({
          level: "error",
          pluginId: worker.pluginId,
          message: `isolated plugin failed: ${String(result.reason)}`,
        });
      }
    }
  }
}
