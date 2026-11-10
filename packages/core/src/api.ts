import OpenAI from 'openai';
import crypto from 'node:crypto';
import type { APIConfig, PromptRunCreate } from './types.js';
import type { DB } from './db.js';

export class OpenAIClient {
  private openai: OpenAI;
  private db: DB;
  private config: APIConfig;

  constructor(db: DB, config: APIConfig) {
    this.db = db;
    this.config = config;
    this.openai = new OpenAI({
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
      // Don't throw on non-200 responses - let the caller handle errors
      defaultHeaders: config.apiKey
        ? { Authorization: `Bearer ${config.apiKey}` }
        : undefined,
    });
  }

  /**
   * Execute a prompt against the configured OpenAI-compatible endpoint.
   * Returns the run result with metrics.
   */
  async execute(data: PromptRunCreate): Promise<{
    run: PromptRunCreate & { tokenCount: number; latencyMs: number; cost?: number };
    output: string;
  }> {
    const startTime = Date.now();

    try {
      const messages: OpenAI.ChatCompletionMessageParam[] = [];

      // Add system prompt if present
      if (data.systemPrompt) {
        messages.push({ role: 'system', content: data.systemPrompt });
      }

      // Add user message with the input
      messages.push({ role: 'user', content: data.input });

      const completion = await this.openai.chat.completions.create({
        model: data.model,
        messages,
        temperature: data.temperature,
        max_tokens: data.maxTokens,
      });

      const output = completion.choices[0]?.message?.content ?? '';
      const latencyMs = Date.now() - startTime;

      // Estimate token count from the response
      const tokenCount = this.estimateTokenCount(output);

      // Estimate cost (rough approximation)
      const cost = this.estimateCost(data.model, tokenCount);

      const run = {
        ...data,
        tokenCount,
        latencyMs,
        cost,
      };

      return { run, output };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return {
        run: {
          ...data,
          tokenCount: 0,
          latencyMs,
          error: errorMessage,
        },
        output: '',
      };
    }
  }

  /**
   * Execute a prompt with streaming response.
   * Yields chunks as they arrive.
   */
  async *executeStream(data: PromptRunCreate): AsyncGenerator<string, void, unknown> {
    const startTime = Date.now();

    try {
      const messages: OpenAI.ChatCompletionMessageParam[] = [];

      if (data.systemPrompt) {
        messages.push({ role: 'system', content: data.systemPrompt });
      }

      messages.push({ role: 'user', content: data.input });

      const stream = await this.openai.chat.completions.create({
        model: data.model,
        messages,
        temperature: data.temperature,
        max_tokens: data.maxTokens,
        stream: true,
      });

      let fullOutput = '';

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content ?? '';
        if (content) {
          fullOutput += content;
          yield content;
        }
      }

      const latencyMs = Date.now() - startTime;
      const tokenCount = this.estimateTokenCount(fullOutput);
      const cost = this.estimateCost(data.model, tokenCount);

      // Save the run to the database
      await this.saveRun({
        ...data,
        tokenCount,
        latencyMs,
        cost,
      }, fullOutput);
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Save error run
      await this.saveRun({
        ...data,
        tokenCount: 0,
        latencyMs,
        error: errorMessage,
      }, '');
    }
  }

  /**
   * Save a run to the database.
   */
  private async saveRun(
    data: PromptRunCreate & { tokenCount: number; latencyMs: number; cost?: number },
    output: string,
  ): Promise<void> {
    const conn = this.db.connection;
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    conn.prepare(
      `INSERT INTO prompt_runs (id, prompt_id, version_id, input, output, model, temperature, max_tokens, system_prompt, token_count, latency_ms, cost, created_at, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      data.promptId,
      data.versionId,
      data.input,
      output,
      data.model,
      data.temperature,
      data.maxTokens,
      data.systemPrompt ?? null,
      data.tokenCount,
      data.latencyMs,
      data.cost ?? null,
      createdAt,
      data.error ?? null,
    );
  }

  /**
   * Estimate token count from text (rough approximation).
   * Uses a simple word-based heuristic.
   */
  private estimateTokenCount(text: string): number {
    // Rough estimate: ~4 characters per token for English text
    return Math.ceil(text.length / 4);
  }

  /**
   * Estimate cost based on model and token count.
   * Uses rough per-token pricing.
   */
  private estimateCost(model: string, tokenCount: number): number | undefined {
    // Rough pricing per 1K tokens (input + output combined estimate)
    const pricing: Record<string, number> = {
      'gpt-4': 0.03,
      'gpt-4-turbo': 0.01,
      'gpt-3.5-turbo': 0.002,
      'claude-3-opus': 0.075,
      'claude-3-sonnet': 0.003,
      'claude-3-haiku': 0.00025,
    };

    const pricePerK = pricing[model.toLowerCase()] ?? 0.01;
    return Math.round((tokenCount / 1000) * pricePerK * 10000) / 10000;
  }

  /**
   * Get the current API configuration.
   */
  getConfig(): APIConfig {
    return this.config;
  }

  /**
   * Update the API configuration.
   */
  updateConfig(config: APIConfig): void {
    this.config = config;
    this.openai = new OpenAI({
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
      defaultHeaders: config.apiKey
        ? { Authorization: `Bearer ${config.apiKey}` }
        : undefined,
    });
  }
}
