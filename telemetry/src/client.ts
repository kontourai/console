// client.ts — typed clients for the console telemetry/pricing intake URLs.
//
// The console is the distribution hub; this is the typed surface for its URLs,
// shared by producers (post events / fetch pricing) and tooling.

import type { PricingRegistry } from "./types";

export interface TelemetryClientOptions {
  /** Console base URL, e.g. https://console.example.com */
  baseUrl: string;
  /** Optional bearer token / tenant headers. */
  headers?: Record<string, string>;
}

export class ConsoleTelemetryClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(options: TelemetryClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.headers = { "content-type": "application/json", ...(options.headers || {}) };
  }

  /** POST one or more telemetry records to the console intake. */
  async postTelemetry(records: unknown[]): Promise<Response> {
    return fetch(`${this.baseUrl}/api/telemetry/records`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(records.length === 1 ? records[0] : records)
    });
  }

  /** Fetch the live pricing registry served by the console. */
  async getPricing(): Promise<PricingRegistry> {
    const res = await fetch(`${this.baseUrl}/api/telemetry/pricing`, { headers: this.headers });
    if (!res.ok) throw new Error(`pricing fetch failed: ${res.status}`);
    return (await res.json()) as PricingRegistry;
  }
}
