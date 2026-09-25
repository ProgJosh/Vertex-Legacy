export type ApiClientOptions = {
  baseUrl: string;
  headers?: HeadersInit;
};

export class VertexApiClient {
  constructor(private readonly options: ApiClientOptions) {}

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(this.options.baseUrl + path, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...this.options.headers,
        ...init?.headers,
      },
      cache: "no-store",
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message ?? "Vertex API request failed.");
    }
    return response.json() as Promise<T>;
  }
}
