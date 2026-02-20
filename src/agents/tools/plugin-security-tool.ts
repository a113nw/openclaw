import { Type } from "@sinclair/typebox";
import { getGlobalPluginRegistry } from "../../plugins/hook-runner-global.js";
import {
  loadPolicy,
  savePolicy,
  listPolicies,
  type PluginSecurityPolicy,
  type PluginTrustLevel,
} from "../../security/plugin-security-policy.js";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";

const ACTIONS = ["list", "get", "set"] as const;

const TRUST_LEVELS = ["trusted", "restricted", "disabled"] as const;

const PluginSecurityToolSchema = Type.Object({
  action: stringEnum(ACTIONS),
  pluginId: Type.Optional(Type.String()),
  trustLevel: Type.Optional(stringEnum(TRUST_LEVELS)),
  capabilities: Type.Optional(Type.Array(Type.String())),
});

export function createPluginSecurityTool(): AnyAgentTool {
  return {
    label: "Plugin Security",
    name: "plugin_security",
    description:
      'Manage plugin security policies. Actions:\n' +
      '- "list": List all loaded plugins with their trust level, origin, and registrations summary.\n' +
      '- "get": Get the security policy for a specific plugin. Requires pluginId.\n' +
      '- "set": Set the security policy for a plugin. Requires pluginId and trustLevel.\n\n' +
      "Trust levels:\n" +
      '- "trusted": Full access, current default behavior. Plugin runs in-process with all API methods available.\n' +
      '- "restricted": Worker isolation + default-deny capability enforcement. Only explicitly granted capabilities are available.\n' +
      '- "disabled": Plugin will not be loaded on next restart.\n\n' +
      "Changes take effect on gateway restart. Use optional capabilities array with restricted level to grant specific capabilities (e.g. network, messaging, provider, cli).",
    parameters: PluginSecurityToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      if (action === "list") {
        const registry = getGlobalPluginRegistry();
        const plugins = registry?.plugins ?? [];
        const policies = listPolicies();
        const policyMap = new Map(policies.map((p) => [p.pluginId, p]));

        const result = plugins.map((plugin) => {
          const policy = policyMap.get(plugin.id);
          return {
            pluginId: plugin.id,
            name: plugin.name,
            origin: plugin.origin,
            status: plugin.status,
            trustLevel: policy?.trustLevel ?? "unconfigured",
            registrations: {
              tools: plugin.toolNames,
              channels: plugin.channelIds,
              providers: plugin.providerIds,
              hooks: plugin.hookCount,
              services: plugin.services,
              commands: plugin.commands,
              httpHandlers: plugin.httpHandlers,
              gatewayMethods: plugin.gatewayMethods,
              cliCommands: plugin.cliCommands,
            },
          };
        });

        return jsonResult({ ok: true, plugins: result });
      }

      if (action === "get") {
        const pluginId = readStringParam(params, "pluginId", { required: true });
        const policy = loadPolicy(pluginId);
        return jsonResult({
          ok: true,
          pluginId,
          policy: policy ?? { pluginId, trustLevel: "unconfigured" },
        });
      }

      if (action === "set") {
        const pluginId = readStringParam(params, "pluginId", { required: true });
        const trustLevel = readStringParam(params, "trustLevel", { required: true });

        if (!TRUST_LEVELS.includes(trustLevel as PluginTrustLevel)) {
          throw new Error(`Invalid trustLevel: ${trustLevel}. Must be one of: ${TRUST_LEVELS.join(", ")}`);
        }

        const capabilities = Array.isArray(params.capabilities)
          ? (params.capabilities as unknown[])
              .filter((c): c is string => typeof c === "string")
              .map((c) => c.trim())
              .filter(Boolean)
          : undefined;

        const policy: PluginSecurityPolicy = {
          pluginId,
          trustLevel: trustLevel as PluginTrustLevel,
          setAt: Date.now(),
          setBy: "brain",
          ...(capabilities && capabilities.length > 0 ? { capabilities } : {}),
        };

        savePolicy(policy);
        return jsonResult({
          ok: true,
          pluginId,
          policy,
          note: "Policy saved. Changes take effect on gateway restart.",
        });
      }

      throw new Error(`Unknown action: ${action}`);
    },
  };
}
