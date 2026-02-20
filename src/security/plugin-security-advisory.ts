/**
 * Plugin security advisory hook.
 *
 * When plugins load without a stored security policy, this module
 * registers a `before_prompt_build` hook that advises the brain
 * to ask the user which trust level to apply.  The advisory fires
 * once per session (tracked by a module-level Set).
 */

import { loadPolicy } from "./plugin-security-policy.js";
import type { PluginRegistry } from "../plugins/registry.js";
import type {
  PluginHookRegistration as TypedPluginHookRegistration,
  PluginHookBeforePromptBuildEvent,
  PluginHookBeforePromptBuildResult,
  PluginHookAgentContext,
} from "../plugins/types.js";

const advisedSessions = new Set<string>();

export function resetAdvisedSessions(): void {
  advisedSessions.clear();
}

export function registerSecurityAdvisoryHook(registry: PluginRegistry): void {
  const unconfigured = registry.plugins.filter(
    (p) => p.status === "loaded" && !loadPolicy(p.id),
  );

  if (unconfigured.length === 0) {
    return;
  }

  const lines = unconfigured.map((p) => {
    const regs: string[] = [];
    if (p.toolNames.length > 0) regs.push(`tools[${p.toolNames.join(",")}]`);
    if (p.channelIds.length > 0) regs.push(`channels[${p.channelIds.join(",")}]`);
    if (p.providerIds.length > 0) regs.push(`providers[${p.providerIds.join(",")}]`);
    if (p.hookCount > 0) regs.push(`hooks[${p.hookCount}]`);
    if (p.services.length > 0) regs.push(`services[${p.services.join(",")}]`);
    if (p.commands.length > 0) regs.push(`commands[${p.commands.join(",")}]`);
    if (p.httpHandlers > 0) regs.push(`httpHandlers[${p.httpHandlers}]`);
    if (p.gatewayMethods.length > 0) regs.push(`gateway[${p.gatewayMethods.join(",")}]`);
    if (p.cliCommands.length > 0) regs.push(`cli[${p.cliCommands.join(",")}]`);
    const regStr = regs.length > 0 ? regs.join(", ") : "none";
    return `- ${p.id} (${p.origin}) — registers: ${regStr}`;
  });

  const advisoryText =
    "[PLUGIN SECURITY ADVISORY]\n" +
    "The following plugins loaded without a security policy:\n" +
    lines.join("\n") +
    "\n" +
    'Use the plugin_security tool to configure each. Trust levels:\n' +
    '- "trusted": Full access (current default)\n' +
    '- "restricted": Worker isolation + capability enforcement\n' +
    '- "disabled": Do not load\n' +
    "Ask the user which level they prefer for each plugin.";

  const handler = (
    _event: PluginHookBeforePromptBuildEvent,
    ctx: PluginHookAgentContext,
  ): PluginHookBeforePromptBuildResult | undefined => {
    const sessionId = ctx.sessionKey ?? "default";
    if (advisedSessions.has(sessionId)) {
      return undefined;
    }
    advisedSessions.add(sessionId);
    return { prependContext: advisoryText };
  };

  registry.typedHooks.push({
    pluginId: "__security_advisory",
    hookName: "before_prompt_build",
    handler,
    priority: 1000,
    source: "security/plugin-security-advisory",
  } as TypedPluginHookRegistration);
}
