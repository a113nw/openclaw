import { describe, expect, it, vi } from "vitest";

vi.mock("../agents/model-selection.js", () => ({
  resolveConfiguredModelRef: () => ({ provider: "test", model: "test-model" }),
}));

vi.mock("../logging.js", () => ({
  getResolvedLoggerSettings: () => ({ file: "/tmp/test.log" }),
}));

import { logGatewayStartup } from "./server-startup-log.js";

function makeParams(overrides: {
  bindHost?: string;
  bindHosts?: string[];
  tlsEnabled?: boolean;
}) {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
  };
  return {
    params: {
      cfg: {} as ReturnType<typeof import("../config/config.js").loadConfig>,
      bindHost: overrides.bindHost ?? "127.0.0.1",
      bindHosts: overrides.bindHosts,
      port: 18789,
      tlsEnabled: overrides.tlsEnabled,
      log,
      isNixMode: false,
    },
    log,
  };
}

const TRANSPORT_WARNING =
  "gateway: binding to non-loopback address without TLS — WebSocket traffic is unencrypted. " +
  "Enable gateway.tls or use Tailscale/SSH tunnel for encrypted transport. " +
  "See SECURITY.md for guidance.";

describe("logGatewayStartup transport security warning", () => {
  it("warns when non-loopback host and no TLS", () => {
    const { params, log } = makeParams({ bindHost: "192.168.1.100" });
    logGatewayStartup(params);
    expect(log.warn).toHaveBeenCalledWith(TRANSPORT_WARNING);
  });

  it("does not warn when non-loopback host with TLS enabled", () => {
    const { params, log } = makeParams({
      bindHost: "192.168.1.100",
      tlsEnabled: true,
    });
    logGatewayStartup(params);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("does not warn when loopback host and no TLS", () => {
    const { params, log } = makeParams({ bindHost: "127.0.0.1" });
    logGatewayStartup(params);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("does not warn when loopback host with TLS", () => {
    const { params, log } = makeParams({
      bindHost: "127.0.0.1",
      tlsEnabled: true,
    });
    logGatewayStartup(params);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("warns when mixed loopback/non-loopback hosts without TLS", () => {
    const { params, log } = makeParams({
      bindHost: "127.0.0.1",
      bindHosts: ["127.0.0.1", "192.168.1.100"],
    });
    logGatewayStartup(params);
    expect(log.warn).toHaveBeenCalledWith(TRANSPORT_WARNING);
  });

  it("warns when binding to 0.0.0.0 (all interfaces) without TLS", () => {
    const { params, log } = makeParams({ bindHost: "0.0.0.0" });
    logGatewayStartup(params);
    expect(log.warn).toHaveBeenCalledWith(TRANSPORT_WARNING);
  });
});
