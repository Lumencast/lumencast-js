// HTTP client for the LSDP/1 interop test control plane.
// Spec: lumencast-protocol/interop/CONTROL.md

export interface SetupRequest {
  scenario: string;
  tokens: Record<string, string>;
  bundles: Array<{ id: string; hash: string; inline: unknown }>;
  initial_state: Record<string, unknown>;
}

export interface SetupResponse {
  ws_url: string;
  scene_id: string;
  scene_version: string;
}

export interface StateResponse {
  scene_id: string;
  scene_version: string;
  state: Record<string, unknown>;
}

export interface HealthResponse {
  status: string;
  control_plane_version: number;
  server?: string;
}

export class ControlClient {
  constructor(private readonly baseUrl: string) {}

  async setup(req: SetupRequest): Promise<SetupResponse> {
    return await this.postJson<SetupResponse>("/test/setup", req);
  }

  async reset(): Promise<void> {
    await this.postNoBody("/test/reset");
  }

  async state(): Promise<StateResponse> {
    return await this.getJson<StateResponse>("/test/state");
  }

  async emit(patches: Array<{ path: string; value: unknown }>): Promise<void> {
    await this.postNoBody("/test/emit", { patches });
  }

  async health(): Promise<HealthResponse> {
    return await this.getJson<HealthResponse>("/test/health");
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status >= 400) {
      throw await this.toProblem(res, path);
    }
    return (await res.json()) as T;
  }

  private async postNoBody(path: string, body?: unknown): Promise<void> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: body !== undefined ? { "content-type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status >= 400) {
      throw await this.toProblem(res, path);
    }
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (res.status >= 400) {
      throw await this.toProblem(res, path);
    }
    return (await res.json()) as T;
  }

  private async toProblem(res: Response, path: string): Promise<Error> {
    let detail: string;
    try {
      const body = (await res.json()) as { detail?: string; title?: string };
      detail = body.detail ?? body.title ?? `${res.status}`;
    } catch {
      detail = `${res.status}`;
    }
    return new Error(`control: ${path} → ${res.status}: ${detail}`);
  }
}
