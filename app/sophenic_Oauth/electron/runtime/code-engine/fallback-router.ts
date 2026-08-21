export interface ModelProvider { name: string; available: () => boolean; }

export class FallbackRouter {
  constructor(private providers: ModelProvider[]) {}

  select() {
    return this.providers.find(p => p.available());
  }

  async execute<T>(job: (provider: ModelProvider) => Promise<T>) {
    let lastError: unknown;
    for (const provider of this.providers) {
      if (!provider.available()) continue;
      try { return await job(provider); } catch (e) { lastError = e; }
    }
    throw lastError ?? new Error('No AI provider available');
  }
}
