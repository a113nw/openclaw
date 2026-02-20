/**
 * Test plugin that throws during registration.
 * Should be caught and marked as error.
 */
export function register(_api: unknown) {
  throw new Error("intentional registration crash");
}
