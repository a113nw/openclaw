let _cached: boolean | undefined;

export function isCredentialEncryptionEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (_cached !== undefined) return _cached;
  _cached = resolveCredentialEncryptionConfig(env);
  return _cached;
}

export function resolveCredentialEncryptionConfig(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.OPENCLAW_ENCRYPT_CREDENTIALS;
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

export function resetCredentialEncryptionConfigForTest(): void {
  _cached = undefined;
}
