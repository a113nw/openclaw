import { describe, expect, it } from "vitest";
import {
  serializeToolDescriptor,
  isValidToolDescriptor,
  validateRoundTrip,
} from "./serialization.js";

describe("serialization", () => {
  describe("serializeToolDescriptor", () => {
    it("extracts name and description", () => {
      const tool = {
        name: "my-tool",
        description: "Does something",
        execute: () => {},
      };
      const desc = serializeToolDescriptor(tool);
      expect(desc.name).toBe("my-tool");
      expect(desc.description).toBe("Does something");
      // execute should not be in the result
      expect("execute" in desc).toBe(false);
    });

    it("extracts parameters", () => {
      const tool = {
        name: "parameterized",
        parameters: {
          type: "object",
          properties: {
            input: { type: "string" },
          },
        },
      };
      const desc = serializeToolDescriptor(tool);
      expect(desc.parameters).toEqual({
        type: "object",
        properties: { input: { type: "string" } },
      });
    });

    it("handles tool with no optional fields", () => {
      const desc = serializeToolDescriptor({ name: "minimal" });
      expect(desc.name).toBe("minimal");
      expect(desc.description).toBeUndefined();
      expect(desc.parameters).toBeUndefined();
    });

    it("extracts label when present", () => {
      const desc = serializeToolDescriptor({ name: "tool", label: "My Tool" });
      expect(desc.label).toBe("My Tool");
    });
  });

  describe("isValidToolDescriptor", () => {
    it("returns true for valid descriptor", () => {
      expect(isValidToolDescriptor({ name: "test" })).toBe(true);
    });

    it("returns false for empty name", () => {
      expect(isValidToolDescriptor({ name: "" })).toBe(false);
    });

    it("returns false for null", () => {
      expect(isValidToolDescriptor(null)).toBe(false);
    });

    it("returns false for non-object", () => {
      expect(isValidToolDescriptor("string")).toBe(false);
    });

    it("returns false when name is missing", () => {
      expect(isValidToolDescriptor({ description: "no name" })).toBe(false);
    });
  });

  describe("validateRoundTrip", () => {
    it("succeeds for valid tool", () => {
      const result = validateRoundTrip({
        name: "test-tool",
        description: "A test tool",
        parameters: { type: "object" },
        execute: () => {},
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.descriptor.name).toBe("test-tool");
      }
    });

    it("fails for tool without name", () => {
      const result = validateRoundTrip({ description: "no name" });
      expect(result.ok).toBe(false);
    });

    it("verifies JSON round-trip works", () => {
      const tool = {
        name: "round-trip-test",
        parameters: {
          type: "object",
          properties: {
            nested: { type: "array", items: { type: "number" } },
          },
        },
      };
      const result = validateRoundTrip(tool);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.descriptor.parameters).toEqual(tool.parameters);
      }
    });
  });
});
