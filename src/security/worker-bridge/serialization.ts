/**
 * Tool descriptor serialization — extract serializable parts from tool objects.
 */
import type { SerializedToolDescriptor } from "./protocol.js";

/**
 * Extract a serializable tool descriptor from a tool object.
 * Strips the `execute` handler and any non-serializable fields.
 */
export function serializeToolDescriptor(
  tool: Record<string, unknown>,
): SerializedToolDescriptor {
  return {
    name: String(tool.name ?? ""),
    ...(typeof tool.label === "string" ? { label: tool.label } : {}),
    ...(typeof tool.description === "string" ? { description: tool.description } : {}),
    ...(tool.parameters && typeof tool.parameters === "object"
      ? { parameters: JSON.parse(JSON.stringify(tool.parameters)) as Record<string, unknown> }
      : {}),
  };
}

/**
 * Validate a serialized tool descriptor has required fields.
 */
export function isValidToolDescriptor(
  desc: unknown,
): desc is SerializedToolDescriptor {
  if (!desc || typeof desc !== "object") return false;
  const d = desc as Record<string, unknown>;
  return typeof d.name === "string" && d.name.length > 0;
}

/**
 * Round-trip validation: serialize and then validate.
 */
export function validateRoundTrip(
  tool: Record<string, unknown>,
): { ok: true; descriptor: SerializedToolDescriptor } | { ok: false; error: string } {
  try {
    const descriptor = serializeToolDescriptor(tool);
    if (!isValidToolDescriptor(descriptor)) {
      return { ok: false, error: "serialized descriptor missing required name field" };
    }
    // Verify JSON round-trip
    const json = JSON.stringify(descriptor);
    const parsed = JSON.parse(json) as SerializedToolDescriptor;
    if (parsed.name !== descriptor.name) {
      return { ok: false, error: "round-trip name mismatch" };
    }
    return { ok: true, descriptor };
  } catch (err) {
    return { ok: false, error: `serialization failed: ${String(err)}` };
  }
}
