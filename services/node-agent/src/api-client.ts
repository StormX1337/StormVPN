import type {
  AgentConfigResponse,
  AgentHeartbeatInput,
  AgentHeartbeatResponse,
  AgentRegisterInput,
  AgentRegisterResponse,
} from '@stormvpn/validation';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }

  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** HTTPS client for the StormVPN control plane with timeouts and retry/backoff. */
export class ControlPlaneClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private token: string | null = null,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly retries = 3,
  ) {}

  setToken(token: string): void {
    this.token = token;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; data: T | null; headers: Headers }> {
    let lastError: ApiError | undefined;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const response = await this.fetchImpl(
          `${this.baseUrl.replace(/\/$/, '')}/api/v1/agent${path}`,
          {
            method,
            headers: {
              'content-type': 'application/json',
              'user-agent': 'stormvpn-agent',
              ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
              ...headers,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(this.timeoutMs),
          },
        );
        if (response.status === 304) return { status: 304, data: null, headers: response.headers };
        const text = await response.text();
        const json = text ? (JSON.parse(text) as unknown) : null;
        if (!response.ok) {
          const error = (json as { error?: { code?: string; message?: string } } | null)?.error;
          throw new ApiError(
            response.status,
            error?.code ?? 'http_error',
            error?.message ?? `HTTP ${response.status}`,
          );
        }
        return { status: response.status, data: json as T, headers: response.headers };
      } catch (error) {
        lastError =
          error instanceof ApiError
            ? error
            : new ApiError(0, 'network_error', (error as Error).message);
        if (!lastError.retryable || attempt === this.retries) throw lastError;
        await sleep(Math.min(30_000, 500 * 2 ** attempt + Math.random() * 250));
      }
    }
    throw lastError!;
  }

  async register(input: AgentRegisterInput): Promise<AgentRegisterResponse> {
    return (await this.request<AgentRegisterResponse>('POST', '/register', input)).data!;
  }

  async heartbeat(input: AgentHeartbeatInput): Promise<AgentHeartbeatResponse> {
    return (await this.request<AgentHeartbeatResponse>('POST', '/heartbeat', input)).data!;
  }

  /** Returns null when the configuration is unchanged (ETag match). */
  async config(knownRevision: number | null): Promise<AgentConfigResponse | null> {
    const headers: Record<string, string> =
      knownRevision !== null ? { 'if-none-match': `"rev-${knownRevision}"` } : {};
    const response = await this.request<AgentConfigResponse>('GET', '/config', undefined, headers);
    return response.status === 304 ? null : response.data;
  }

  async rotateToken(): Promise<string> {
    return (await this.request<{ nodeToken: string }>('POST', '/rotate-token', {})).data!.nodeToken;
  }
}
