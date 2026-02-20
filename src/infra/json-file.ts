import fs from "node:fs";
import path from "node:path";
import { openJson, sealJson } from "../security/credential-envelope.js";

export type JsonFileOptions = { encrypt?: boolean; decrypt?: boolean };

export function loadJsonFile(pathname: string, options?: JsonFileOptions): unknown {
  try {
    if (!fs.existsSync(pathname)) {
      return undefined;
    }
    const raw = fs.readFileSync(pathname, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (options?.decrypt) return openJson(parsed);
    return parsed;
  } catch {
    return undefined;
  }
}

export function saveJsonFile(pathname: string, data: unknown, options?: JsonFileOptions) {
  const dir = path.dirname(pathname);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const toWrite = options?.encrypt ? sealJson(data) : data;
  fs.writeFileSync(pathname, `${JSON.stringify(toWrite, null, 2)}\n`, "utf8");
  fs.chmodSync(pathname, 0o600);
}
