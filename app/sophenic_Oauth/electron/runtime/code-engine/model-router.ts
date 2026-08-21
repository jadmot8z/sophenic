export type ModelProvider = 'openai'|'anthropic'|'google'|'groq'|'xai';

export interface ModelAttempt { provider: ModelProvider; success: boolean; error?: string }

export class ModelRouter {
  private providers: ModelProvider[];
  constructor(providers?: ModelProvider[]) {
    this.providers = providers ?? ['openai','anthropic','google','groq','xai'];
  }

  async execute<T>(handler: (provider: ModelProvider)=>Promise<T>) {
    const attempts: ModelAttempt[] = [];
    for (const provider of this.providers) {
      try {
        const result = await handler(provider);
        attempts.push({provider, success:true});
        return { result, attempts };
      } catch (e) {
        attempts.push({provider, success:false, error:String(e)});
      }
    }
    throw new Error(`Tous les modèles IA ont échoué: ${JSON.stringify(attempts)}`);
  }
}
