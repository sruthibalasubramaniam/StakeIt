import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { UNAUTHORIZED_EVENT, tokenStore } from './tokenStore';

/**
 * Single axios instance for the whole app.
 *
 * - injects the bearer token
 * - converts every failure into a typed `ApiClientError` so components can
 *   branch on `error.code` instead of parsing strings
 * - broadcasts 401s so the auth context can clear the session
 */
export interface ApiErrorShape {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(status: number, shape: ApiErrorShape) {
    super(shape.message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = shape.code;
    this.details = shape.details;
    this.requestId = shape.requestId;
  }

  /** Field-level validation issues, when the server sent any. */
  get issues(): Array<{ path?: string; field?: string; message: string }> {
    const details = this.details as { issues?: Array<{ path?: string; field?: string; message: string }> } | undefined;
    return details?.issues ?? [];
  }
}

const baseURL = import.meta.env.VITE_API_URL || '/api';

export const apiClient: AxiosInstance = axios.create({
  baseURL,
  timeout: 45_000,
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ error?: ApiErrorShape }>) => {
    // Network / timeout / CORS failures never reach the server.
    if (!error.response) {
      return Promise.reject(
        new ApiClientError(0, {
          code: 'NETWORK_ERROR',
          message:
            error.code === 'ECONNABORTED'
              ? 'The request timed out. Check that the API is running and try again.'
              : 'Cannot reach the Stake It API. Check that the backend is running and VITE_API_URL is correct.',
        }),
      );
    }

    const status = error.response.status;
    const shape = error.response.data?.error ?? {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
    };

    if (status === 401) {
      // The token is gone or expired — let the app drop the session.
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: shape.code }));
    }

    return Promise.reject(new ApiClientError(status, shape));
  },
);

/** Unwraps the `{ data: ... }` envelope every endpoint returns. */
export async function unwrap<T>(promise: Promise<{ data: { data: T } }>): Promise<T> {
  const response = await promise;
  return response.data.data;
}

export const http = {
  get: <T>(url: string, config?: AxiosRequestConfig) => unwrap<T>(apiClient.get(url, config)),
  post: <T>(url: string, body?: unknown, config?: AxiosRequestConfig) => unwrap<T>(apiClient.post(url, body ?? {}, config)),
  put: <T>(url: string, body?: unknown, config?: AxiosRequestConfig) => unwrap<T>(apiClient.put(url, body ?? {}, config)),
  patch: <T>(url: string, body?: unknown, config?: AxiosRequestConfig) => unwrap<T>(apiClient.patch(url, body ?? {}, config)),
  delete: <T>(url: string, config?: AxiosRequestConfig) => unwrap<T>(apiClient.delete(url, config)),
};

/** Human-readable message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    const issues = error.issues;
    if (issues.length > 0) return issues.map((issue) => issue.message).join(' ');
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred.';
}

export function isApiError(error: unknown, code?: string): error is ApiClientError {
  return error instanceof ApiClientError && (code === undefined || error.code === code);
}
