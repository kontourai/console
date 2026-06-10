export function redactTelemetryValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactTelemetryValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(Object.entries(value).map(([key, nested]) => {
    if (isSensitiveTelemetryKey(key)) return [key, "[redacted]"];
    return [key, redactTelemetryValue(nested)];
  }));
}

export function isSensitiveTelemetryKey(key: string): boolean {
  return /authorization|api[-_]?key|password|secret|token/i.test(key);
}
