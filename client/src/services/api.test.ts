import { describe, it, expect } from 'vitest';
import { ApiError } from './api.js';

describe('ApiError', () => {
  it('carries status and message', () => {
    const err = new ApiError(404, 'Not found');
    expect(err.status).toBe(404);
    expect(err.message).toBe('Not found');
    expect(err.name).toBe('ApiError');
  });

  it('is instanceof Error', () => {
    expect(new ApiError(500, 'oops')).toBeInstanceOf(Error);
  });

  it('is instanceof ApiError', () => {
    expect(new ApiError(422, 'bad')).toBeInstanceOf(ApiError);
  });
});
