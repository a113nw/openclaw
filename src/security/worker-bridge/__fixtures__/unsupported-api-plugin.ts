/**
 * Test plugin that tries to use unsupported API methods.
 * Should fail cleanly in worker mode.
 */
export function register(api: {
  registerChannel: (registration: unknown) => void;
}) {
  api.registerChannel({ id: "test-channel", plugin: {} });
}
