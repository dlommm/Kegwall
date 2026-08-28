// Auth: setup probe, session, login/logout (the /api/auth/* routes).
import type { User } from '../../../server/db/users.js';
import { request, type ApiResult } from '../adminHttp';

export function needsSetup(): Promise<ApiResult<{ needsSetup: boolean }>> {
  return request('/api/auth/needs-setup');
}

export function getMe(): Promise<ApiResult<User>> {
  return request('/api/auth/me');
}

export function login(username: string, password: string): Promise<ApiResult<User>> {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function logout(): Promise<ApiResult<{ ok: boolean }>> {
  return request('/api/auth/logout', { method: 'POST' });
}

export function setup(input: {
  username: string; displayName: string; password: string; claimToken?: string;
}): Promise<ApiResult<User>> {
  return request('/api/auth/setup', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
