/**
 * Plugin capability declaration and enforcement (Stage A).
 *
 * Plugins declare required capabilities in their manifest.  When a
 * plugin lacks a capability, the corresponding API registration
 * methods throw rather than silently succeeding.  This provides a
 * declarative guard until full Worker Thread isolation (Stage B).
 */

/** Recognised plugin capabilities. */
export type PluginCapability =
  | "filesystem"
  | "network"
  | "child_process"
  | "env_access"
  | "config_write"
  | "messaging"
  | "provider"
  | "cli";

export const ALL_CAPABILITIES: readonly PluginCapability[] = [
  "filesystem",
  "network",
  "child_process",
  "env_access",
  "config_write",
  "messaging",
  "provider",
  "cli",
] as const;

/**
 * Validate declared capabilities against a policy.
 * Returns denied capabilities (those requested but disallowed by policy).
 */
export function validatePluginCapabilities(
  declared: PluginCapability[],
  policy: { allowed: PluginCapability[] },
): { allowed: boolean; denied: PluginCapability[] } {
  const denied = declared.filter((cap) => !policy.allowed.includes(cap));
  return { allowed: denied.length === 0, denied };
}

/**
 * Capability → API method names that require it.
 * Methods not listed here are always allowed.
 */
const CAPABILITY_METHODS: Record<PluginCapability, readonly string[]> = {
  filesystem: [],
  network: ["registerHttpHandler", "registerHttpRoute", "registerGatewayMethod"],
  child_process: [],
  env_access: [],
  config_write: [],
  messaging: ["registerChannel"],
  provider: ["registerProvider"],
  cli: ["registerCli"],
};

/**
 * Wrap a plugin API object so that methods requiring undeclared
 * capabilities throw a descriptive error.
 */
export function createRestrictedPluginApi<T extends Record<string, unknown>>(
  api: T,
  declaredCapabilities: PluginCapability[],
): T {
  const restricted = new Set<string>();
  for (const [cap, methods] of Object.entries(CAPABILITY_METHODS)) {
    if (!declaredCapabilities.includes(cap as PluginCapability)) {
      for (const method of methods) {
        restricted.add(method);
      }
    }
  }
  if (restricted.size === 0) {
    return api;
  }
  const proxy = { ...api };
  for (const method of restricted) {
    if (typeof api[method] === "function") {
      (proxy as Record<string, unknown>)[method] = () => {
        throw new Error(
          `Plugin attempted to call ${method}() without declaring the required capability. ` +
            `Declare the needed capability in your plugin manifest.`,
        );
      };
    }
  }
  return proxy;
}
