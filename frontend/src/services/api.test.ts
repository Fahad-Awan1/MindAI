import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';
import { getErrorMessage, StreamError } from './api';

const config = { headers: new AxiosHeaders() };
const withResponse = (status: number, data: unknown) =>
  new AxiosError('failed', 'ERR_BAD_RESPONSE', config, null, { status, statusText: '', headers: {}, config, data });

describe('getErrorMessage', () => {
  it('prefers the server detail', () => {
    expect(getErrorMessage(withResponse(400, { detail: 'That code is wrong or has expired.' }), 'fallback'))
      .toBe('That code is wrong or has expired.');
  });

  it('shows the first validation message without the pydantic prefix', () => {
    expect(getErrorMessage(withResponse(422, { detail: [{ msg: 'Value error, Enter a valid email address.' }] }), 'fallback'))
      .toBe('Enter a valid email address.');
  });

  it('explains a missing connection', () => {
    expect(getErrorMessage(new AxiosError('Network Error', 'ERR_NETWORK', config), 'fallback')).toMatch(/can't reach the MindAI server/i);
  });

  it('treats tunnel / gateway HTML errors as the server being unreachable', () => {
    expect(getErrorMessage(withResponse(530, '<html>Cloudflare</html>'), 'fallback')).toMatch(/can't reach the MindAI server/i);
    expect(getErrorMessage(withResponse(502, ''), 'fallback')).toMatch(/can't reach the MindAI server/i);
  });

  it('explains a timeout', () => {
    expect(getErrorMessage(new AxiosError('timeout', 'ECONNABORTED', config), 'fallback')).toMatch(/took too long/i);
  });

  it('passes stream errors through and falls back for unknown errors', () => {
    expect(getErrorMessage(new StreamError('The connection was interrupted.'), 'fallback')).toBe('The connection was interrupted.');
    expect(getErrorMessage(new Error('boom'), 'fallback')).toBe('fallback');
  });
});
