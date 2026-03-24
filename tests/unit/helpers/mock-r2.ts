import { vi } from 'vitest';

export interface MockR2Bucket {
  put: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  head: ReturnType<typeof vi.fn>;
  _store: Map<string, { body: ArrayBuffer; httpMetadata?: Record<string, string> }>;
}

/**
 * Creates a mock R2Bucket backed by an in-memory Map.
 * put() stores data, get() retrieves it as an R2ObjectBody-like object,
 * delete() removes it.
 */
export function createMockR2(): MockR2Bucket {
  const store = new Map<string, { body: ArrayBuffer; httpMetadata?: Record<string, string> }>();

  const bucket: MockR2Bucket = {
    put: vi.fn().mockImplementation(async (key: string, value: ArrayBuffer | Uint8Array | string, options?: { httpMetadata?: Record<string, string> }) => {
      let buf: ArrayBuffer;
      if (value instanceof ArrayBuffer) {
        buf = value;
      } else if (value instanceof Uint8Array) {
        buf = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
      } else if (typeof value === 'string') {
        buf = new TextEncoder().encode(value).buffer as ArrayBuffer;
      } else {
        buf = new ArrayBuffer(0);
      }
      store.set(key, { body: buf, httpMetadata: options?.httpMetadata });
      return { key, version: 'mock-version' };
    }),

    get: vi.fn().mockImplementation(async (key: string) => {
      const entry = store.get(key);
      if (!entry) return null;
      return {
        key,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(entry.body));
            controller.close();
          },
        }),
        bodyUsed: false,
        arrayBuffer: async () => entry.body,
        text: async () => new TextDecoder().decode(entry.body),
        json: async () => JSON.parse(new TextDecoder().decode(entry.body)),
        blob: async () => new Blob([entry.body]),
        httpMetadata: entry.httpMetadata ?? {},
        size: entry.body.byteLength,
      };
    }),

    delete: vi.fn().mockImplementation(async (key: string | string[]) => {
      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) {
        store.delete(k);
      }
    }),

    list: vi.fn().mockResolvedValue({ objects: [], truncated: false }),
    head: vi.fn().mockResolvedValue(null),
    _store: store,
  };

  return bucket;
}
