import { describe, it, expect, vi } from 'vitest';
import { PlatformError } from '../../server/src/errors/platform-error.js';
import { formatErrorResponse } from '../../server/src/errors/format-error.js';
import { errorHandler } from '../../server/src/middleware/error-handler.js';
import type { Request, Response, NextFunction } from 'express';

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
  function createMockRes() {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    return res;
  }

  const mockReq = {} as Request;
  const mockNext = vi.fn() as NextFunction;

  it('handles PlatformError and returns formatted response with status 500 for errors', () => {
    const res = createMockRes();
    const err = new PlatformError({
      severity: 'error',
      component: 'CrossPoster',
      operation: 'publish',
      description: 'Publishing failed.',
      recommendedActions: ['Retry manually'],
    });

    errorHandler(err, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      severity: 'error',
      component: 'CrossPoster',
      operation: 'publish',
      message: 'Publishing failed.',
      actions: ['Retry manually'],
    });
  });

  it('returns status 400 for warnings', () => {
    const res = createMockRes();
    const err = new PlatformError({
      severity: 'warning',
      component: 'ContentGenerator',
      operation: 'generate',
      description: 'Slow generation.',
      recommendedActions: ['Try again'],
    });

    errorHandler(err, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('wraps non-PlatformError in a generic PlatformError', () => {
    const res = createMockRes();
    const err = new Error('Something broke');

    errorHandler(err, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        component: 'Server',
        operation: 'unknown',
        message: 'Something broke',
        actions: expect.arrayContaining([expect.any(String)]),
      }),
    );
  });
});
