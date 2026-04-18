import { describe, it, expect, vi } from 'vitest';
import { PlatformError } from '../../worker/src/errors/platform-error.js';
import { formatErrorResponse } from '../../worker/src/errors/format-error.js';
import { errorHandler } from '../../worker/src/middleware/error-handler.js';
import { createMockD1 } from './helpers/mock-d1.js';

describe('PlatformError class', () => {
  it('creates an instance with all required fields', () => {
    const err = new PlatformError({
      severity: 'error',
      component: 'MediaService',
      operation: 'upload',
      description: 'The file exceeds the 50 MB size limit.',
      recommendedActions: ['Reduce the file size and try again'],
    });

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PlatformError);
    expect(err.name).toBe('PlatformError');
    expect(err.severity).toBe('error');
    expect(err.component).toBe('MediaService');
    expect(err.operation).toBe('upload');
    expect(err.description).toBe('The file exceeds the 50 MB size limit.');
    expect(err.recommendedActions).toEqual(['Reduce the file size and try again']);
    expect(err.message).toBe('The file exceeds the 50 MB size limit.');
  });

  it('accepts warning severity', () => {
    const err = new PlatformError({
      severity: 'warning',
      component: 'ContentGenerator',
      operation: 'generate',
      description: 'Content generation was slow.',
      recommendedActions: ['Try again'],
    });

    expect(err.severity).toBe('warning');
  });

  it('accepts multiple recommended actions', () => {
    const err = new PlatformError({
      severity: 'error',
      component: 'CrossPoster',
      operation: 'publish',
      description: 'Publishing failed.',
      recommendedActions: ['Retry manually', 'Edit the post', 'Re-authenticate'],
    });

    expect(err.recommendedActions).toHaveLength(3);
  });

  it('throws if recommendedActions is empty', () => {
    expect(() => {
      new PlatformError({
        severity: 'error',
        component: 'Server',
        operation: 'test',
        description: 'Test error',
        recommendedActions: [],
      });
    }).toThrow('PlatformError requires at least one recommended action');
  });
});

describe('formatErrorResponse', () => {
  it('maps PlatformError fields to ErrorResponse shape', () => {
    const err = new PlatformError({
      severity: 'error',
      component: 'MediaService',
      operation: 'upload',
      description: 'File too large.',
      recommendedActions: ['Reduce size', 'Try another file'],
    });

    const response = formatErrorResponse(err);

    expect(response).toEqual({
      severity: 'error',
      component: 'MediaService',
      operation: 'upload',
      message: 'File too large.',
      actions: ['Reduce size', 'Try another file'],
    });
  });

  it('maps description to message field', () => {
    const err = new PlatformError({
      severity: 'warning',
      component: 'ContentAdvisor',
      operation: 'suggest',
      description: 'No post history available.',
      recommendedActions: ['Create your first post'],
    });

    const response = formatErrorResponse(err);
    expect(response.message).toBe('No post history available.');
    expect(response.actions).toEqual(['Create your first post']);
  });
});

describe('errorHandler middleware', () => {
  /**
   * Creates a minimal mock Hono context for testing the error handler.
   * The handler calls c.json(), c.env.DB, and c.get('user').
   */
  function createMockContext() {
    const db = createMockD1();
    let capturedBody: unknown = null;
    let capturedStatus: number | undefined;

    const c = {
      env: { DB: db },
      get: vi.fn().mockReturnValue(undefined),
      json: vi.fn().mockImplementation((body: unknown, status?: number) => {
        capturedBody = body;
        capturedStatus = status;
        return new Response(JSON.stringify(body), {
          status: status ?? 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    };

    return { c, db, getCaptured: () => ({ body: capturedBody, status: capturedStatus }) };
  }

  it('handles PlatformError and returns formatted response with status 500 for errors', async () => {
    const { c, getCaptured } = createMockContext();
    const err = new PlatformError({
      severity: 'error',
      component: 'CrossPoster',
      operation: 'publish',
      description: 'Publishing failed.',
      recommendedActions: ['Retry manually'],
    });

    await errorHandler(err, c as any);

    const { body, status } = getCaptured();
    expect(status).toBe(500);
    expect(body).toEqual({
      severity: 'error',
      component: 'CrossPoster',
      operation: 'publish',
      message: 'Publishing failed.',
      actions: ['Retry manually'],
    });
  });

  it('returns status 400 for warnings', async () => {
    const { c, getCaptured } = createMockContext();
    const err = new PlatformError({
      severity: 'warning',
      component: 'ContentGenerator',
      operation: 'generate',
      description: 'Slow generation.',
      recommendedActions: ['Try again'],
    });

    await errorHandler(err, c as any);

    const { status } = getCaptured();
    expect(status).toBe(400);
  });

  it('wraps non-PlatformError in a generic PlatformError', async () => {
    const { c, getCaptured } = createMockContext();
    const err = new Error('Something broke');

    await errorHandler(err, c as any);

    const { body, status } = getCaptured();
    expect(status).toBe(500);
    expect(body).toEqual(
      expect.objectContaining({
        severity: 'error',
        component: 'Server',
        operation: 'unknown',
        message: 'Something broke',
        actions: expect.arrayContaining([expect.any(String)]),
      }),
    );
  });

  it('respects statusCode override on PlatformError', async () => {
    const { c, getCaptured } = createMockContext();
    const err = new PlatformError({
      severity: 'error',
      component: 'MediaService',
      operation: 'upload',
      description: 'Not found.',
      recommendedActions: ['Check the ID'],
      statusCode: 404,
    });

    await errorHandler(err, c as any);

    const { status } = getCaptured();
    expect(status).toBe(404);
  });

  it('logs error to activity_log_entries via D1', async () => {
    const { c, db } = createMockContext();
    const err = new PlatformError({
      severity: 'error',
      component: 'CrossPoster',
      operation: 'publish',
      description: 'Publishing failed.',
      recommendedActions: ['Retry manually'],
    });

    await errorHandler(err, c as any);

    expect(db.prepare).toHaveBeenCalled();
    const insertCall = db.prepare.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO activity_log_entries'),
    );
    expect(insertCall).toBeDefined();
  });
});
