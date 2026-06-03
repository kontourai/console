import type { ServerResponse } from "node:http";

export interface SseClient {
  write(chunk: string): unknown;
  end(): unknown;
}

export interface SseBroker {
  clients: Set<SseClient>;
  add(response: SseClient): void;
  remove(response: SseClient): void;
  broadcast(eventName: string, payload: unknown): void;
  closeAll(): void;
}

export function createSseBroker(): SseBroker {
  const clients = new Set<SseClient>();
  return {
    clients,
    add(response: SseClient) {
      clients.add(response);
    },
    remove(response: SseClient) {
      clients.delete(response);
    },
    broadcast(eventName: string, payload: unknown) {
      for (const client of clients) {
        try {
          writeSse(client, eventName, payload);
        } catch (error) {
          clients.delete(client);
        }
      }
    },
    closeAll() {
      for (const client of clients) {
        client.end();
      }
      clients.clear();
    }
  };
}

export function openSseResponse(response: ServerResponse): void {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    "connection": "keep-alive",
    "x-accel-buffering": "no"
  });
}

export function writeSse(response: SseClient, eventName: string, payload: unknown): void {
  response.write(`event: ${eventName}\n`);
  for (const line of JSON.stringify(payload).split(/\r?\n/)) {
    response.write(`data: ${line}\n`);
  }
  response.write("\n");
}
