import { vi } from 'vitest';

export interface MockQueue {
  send: ReturnType<typeof vi.fn>;
  sendBatch: ReturnType<typeof vi.fn>;
  _messages: unknown[];
}

/**
 * Creates a mock Cloudflare Queue that records sent messages.
 */
export function createMockQueue(): MockQueue {
  const messages: unknown[] = [];

  const queue: MockQueue = {
    send: vi.fn().mockImplementation(async (body: unknown) => {
      messages.push(body);
    }),
    sendBatch: vi.fn().mockImplementation(async (batch: Array<{ body: unknown }>) => {
      for (const msg of batch) {
        messages.push(msg.body);
      }
    }),
    _messages: messages,
  };

  return queue;
}
