/**
 * OpenAI-compatible client for PromptSentry Workbench.
 * Supports streaming and non-streaming execution against any
 * OpenAI-compatible endpoint (Ollama, vLLM, OpenAI, etc.).
 */
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources';
import crypto from 'node:crypto';
import type {
  APIConfig,
  PromptRun,
  PromptRunCreate,
  PromptRunWithExtraParams,
  ExtraParams,
} from './types.js';
import type { DB } from './db.js';

// ─── Response types ──────────────────────────────────────────────────────────

/** Token logprob info from OpenAI-compatible API */
export interface TokenLogprobInfo {
  token: string;
  logprob: number;
  bytes?: number[];
  topLogprobs: Array<{ token: string; logprob: number }>;
}

/** Full response metadata from the API */
export interface APIResponseMetadata {
  id: string;
  model: string;
  createdAt: string;
  /** Token usage from the API (if available) */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Token logprobs (if requested) */
  tokenLogprobs?: TokenLogprobInfo[];
  /** Stop reason from the API */
  stopReason?: string;
}

/** Result of a non-streaming execution */
export interface ExecuteResult {
  run: PromptRunCreate & {
    tokenCount: number;
    latencyMs: number;
    cost?: number;
  };
  output: string;
  metadata: APIResponseMetadata;
}

/** Callback for streaming chunks */
export type StreamChunkCallback = (
  chunk: string,
  cumulative: string,
  metadata: APIResponseMetadata,
) => void;

/** Callback for streaming errors */
export type StreamErrorCallback = (error: Error) => void;

/** Callback for streaming completion */
export type StreamCompleteCallback = (
  output: string,
  metadata: APIResponseMetadata,
) => void;

/** Options for streaming execution */
export interface StreamOptions {
  /** Called for each chunk received */
  onChunk?: StreamChunkCallback;
  /** Called when an error occurs */
  onError?: StreamErrorCallback;
  /** Called when the stream completes */
  onComplete?: StreamCompleteCallback;
  /** Abort the stream with this controller */
  signal?: AbortSignal;
  /** Whether to save the run to the DB after streaming */
  saveRun?: boolean;
}

/** Options for non-streaming execution */
export interface ExecuteOptions {
  /** Whether to save the run to the DB after execution */
  saveRun?: boolean;
}

// ─── OpenAIClient ────────────────────────────────────────────────────────────

export class OpenAIClient {
  private openai: OpenAI;
  private db: DB;
  private config: APIConfig;

  constructor(db: DB, config: APIConfig) {
    this.db = db;
    this.config = config;
    // OpenAI SDK requires an API key even for local endpoints.
    // Use a dummy key for local endpoints (Ollama, vLLM, etc.)
    const apiKey = config.apiKey || 'ollama';
    // Ollama's /v1/chat/completions endpoint works with the OpenAI SDK
    // but we need to ensure the base URL includes /v1
    const baseUrl = config.baseUrl.endsWith('/v1')
      ? config.baseUrl
      : config.baseUrl.replace(/\/api$/, '/v1');
    this.openai = new OpenAI({
      baseURL: baseUrl,
      apiKey,
      defaultHeaders: config.apiKey
        ? { Authorization: `Bearer ${config.apiKey}` }
        : undefined,
      // Increase timeout for local models
      maxRetries: 1,
    });
  }

  // ─── Non-streaming execution ──────────────────────────────────────────────

  /**
   * Execute a prompt against the configured OpenAI-compatible endpoint.
   * Returns the run result with metrics and metadata.
   */
  async execute(
    data: PromptRunWithExtraParams,
    options: ExecuteOptions = {},
  ): Promise<ExecuteResult> {
    const startTime = Date.now();

    try {
      const messages = this.buildMessages(data);

      const completion = await this.openai.chat.completions.create({
        model: data.model,
        messages,
        temperature: data.temperature,
        max_tokens: data.maxTokens,
        ...this.buildExtraParams(data),
      });

      const output = completion.choices[0]?.message?.content ?? '';
      const latencyMs = Date.now() - startTime;

      // Extract token usage from API response
      const usage = completion.usage;
      const tokenCount = usage
        ? (usage.completion_tokens ?? 0) > 0
          ? usage.completion_tokens
          : this.estimateTokenCount(output)
        : this.estimateTokenCount(output);

      // Extract metadata
      const metadata: APIResponseMetadata = {
        id: completion.id,
        model: completion.model,
        createdAt: completion.created
          ? new Date(completion.created * 1000).toISOString()
          : new Date().toISOString(),
        usage: usage
          ? {
              promptTokens: usage.prompt_tokens ?? 0,
              completionTokens: usage.completion_tokens ?? 0,
              totalTokens: usage.total_tokens ?? 0,
            }
          : undefined,
        stopReason: completion.choices[0]?.finish_reason ?? undefined,
      };

      // Estimate cost (rough approximation)
      const cost = this.estimateCost(data.model, tokenCount);

      const run = {
        ...data,
        tokenCount,
        latencyMs,
        cost,
      };

      // Save to DB if requested
      if (options.saveRun) {
        await this.saveRun(run, output);
      }

      return { run, output, metadata };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      const run = {
        ...data,
        tokenCount: 0,
        latencyMs,
        error: errorMessage,
      };

      if (options.saveRun) {
        await this.saveRun(run, '');
      }

      return {
        run,
        output: '',
        metadata: {
          id: crypto.randomUUID(),
          model: data.model,
          createdAt: new Date().toISOString(),
        },
      };
    }
  }

  /**
   * Execute a prompt with streaming response.
   * Yields chunks as they arrive and calls callbacks.
   */
  async executeStream(
    data: PromptRunWithExtraParams,
    options: StreamOptions = {},
  ): Promise<{ output: string; metadata: APIResponseMetadata }> {
    const startTime = Date.now();
    let fullOutput = '';
    let metadata: APIResponseMetadata | undefined;

    try {
      const messages = this.buildMessages(data);

      const stream = await this.openai.chat.completions.create({
        model: data.model,
        messages,
        temperature: data.temperature,
        max_tokens: data.maxTokens,
        stream: true,
        ...this.buildExtraParams(data),
      });

      let completionId = '';
      let completionModel = '';
      let completionCreated = 0;
      let promptTokens = 0;
      let completionTokens = 0;
      let totalTokens = 0;
      let stopReason: string | undefined;

      for await (const chunk of stream) {
        // Abort if signal is set
        if (options.signal?.aborted) {
          break;
        }

        const content = chunk.choices[0]?.delta?.content ?? '';
        if (content) {
          fullOutput += content;
          if (options.onChunk) {
            options.onChunk(content, fullOutput, this.buildPartialMetadata(chunk));
          }
        }

        // Capture metadata from first chunk
        if (!completionId && chunk.id) {
          completionId = chunk.id;
          completionModel = chunk.model ?? data.model;
          completionCreated = chunk.created ?? 0;
        }

        // Accumulate token usage from last chunk
        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
          completionTokens = chunk.usage.completion_tokens ?? completionTokens;
          totalTokens = chunk.usage.total_tokens ?? totalTokens;
        }

        // Capture stop reason from last chunk
        if (chunk.choices[0]?.finish_reason) {
          stopReason = chunk.choices[0].finish_reason;
        }
      }

      const latencyMs = Date.now() - startTime;

      metadata = {
        id: completionId || crypto.randomUUID(),
        model: completionModel || data.model,
        createdAt: completionCreated
          ? new Date(completionCreated * 1000).toISOString()
          : new Date().toISOString(),
        usage: totalTokens > 0
          ? {
              promptTokens,
              completionTokens,
              totalTokens,
            }
          : undefined,
        stopReason,
      };

      const tokenCount = metadata.usage?.completionTokens
        ? metadata.usage.completionTokens
        : this.estimateTokenCount(fullOutput);
      const cost = this.estimateCost(data.model, tokenCount);

      // Save to DB if requested
      if (options.saveRun !== false) {
        await this.saveRun(
          {
            ...data,
            tokenCount,
            latencyMs,
            cost,
          },
          fullOutput,
        );
      }

      if (options.onComplete) {
        options.onComplete(fullOutput, metadata);
      }

      return { output: fullOutput, metadata };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (options.onError) {
        options.onError(new Error(errorMessage));
      }

      // Save error run only if saveRun is not explicitly false
      if (options.saveRun !== false) {
        await this.saveRun(
          {
            ...data,
            tokenCount: 0,
            latencyMs,
            error: errorMessage,
          },
          '',
        );
      }

      metadata = {
        id: crypto.randomUUID(),
        model: data.model,
        createdAt: new Date().toISOString(),
      };

      return { output: fullOutput, metadata };
    }
  }

  /**
   * Execute a prompt and return a ReadableStream of chunks.
   * Useful for programmatic consumption.
   */
  async *executeStreamAsync(data: PromptRunWithExtraParams, options: StreamOptions = {}): AsyncGenerator<
    { chunk: string; cumulative: string; metadata: APIResponseMetadata },
    void,
    unknown
  > {
    const startTime = Date.now();
    let fullOutput = '';
    let metadata: APIResponseMetadata | undefined;

    try {
      const messages = this.buildMessages(data);

      const stream = await this.openai.chat.completions.create({
        model: data.model,
        messages,
        temperature: data.temperature,
        max_tokens: data.maxTokens,
        stream: true,
        ...this.buildExtraParams(data),
      });

      let completionId = '';
      let completionModel = '';
      let completionCreated = 0;
      let promptTokens = 0;
      let completionTokens = 0;
      let totalTokens = 0;
      let stopReason: string | undefined;

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content ?? '';
        if (content) {
          fullOutput += content;
        }

        if (!completionId && chunk.id) {
          completionId = chunk.id;
          completionModel = chunk.model ?? data.model;
          completionCreated = chunk.created ?? 0;
        }

        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
          completionTokens = chunk.usage.completion_tokens ?? completionTokens;
          totalTokens = chunk.usage.total_tokens ?? totalTokens;
        }

        if (chunk.choices[0]?.finish_reason) {
          stopReason = chunk.choices[0].finish_reason;
        }

        if (content) {
          metadata = {
            id: completionId || crypto.randomUUID(),
            model: completionModel || data.model,
            createdAt: completionCreated
              ? new Date(completionCreated * 1000).toISOString()
              : new Date().toISOString(),
            usage: totalTokens > 0
              ? { promptTokens, completionTokens, totalTokens }
              : undefined,
            stopReason,
          };
          yield { chunk: content, cumulative: fullOutput, metadata };
        }
      }

      // Final metadata with complete usage
      metadata = {
        id: completionId || crypto.randomUUID(),
        model: completionModel || data.model,
        createdAt: completionCreated
          ? new Date(completionCreated * 1000).toISOString()
          : new Date().toISOString(),
        usage: totalTokens > 0
          ? { promptTokens, completionTokens, totalTokens }
          : undefined,
        stopReason,
      };

      // Save to DB
      const streamLatencyMs = Date.now() - startTime;
      const streamTokenCount = metadata.usage?.completionTokens
        ? metadata.usage.completionTokens
        : this.estimateTokenCount(fullOutput);
      await this.saveRun(
        {
          ...data,
          tokenCount: streamTokenCount,
          latencyMs: streamLatencyMs,
          cost: this.estimateCost(data.model, streamTokenCount),
        },
        fullOutput,
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      // Only save error run if saveRun is not explicitly false
      if (options.saveRun !== false) {
        await this.saveRun(
          { ...data, tokenCount: 0, latencyMs: 0, error: errorMessage },
          '',
        );
      }
    }
  }

  // ─── Model listing ────────────────────────────────────────────────────────

  /**
   * List available models from the configured endpoint.
   * Uses direct fetch for better compatibility with OpenAI-compatible
   * servers (Ollama, vLLM, etc.) that may not fully implement the SDK.
   */
  async listModels(): Promise<
    Array<{ id: string; object: string; created: number; ownedBy: string }>
  > {
    const apiKey = this.config.apiKey || 'ollama';
    const url = `${this.config.baseUrl}/v1/models`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to list models: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { data: Array<{ id: string; object: string; created: number; owned_by?: string; ownedBy?: string }> };
    return data.data.map((m: any) => ({
      id: m.id,
      object: m.object,
      created: m.created,
      ownedBy: m.owned_by ?? m.ownedBy ?? '',
    }));
  }

  /**
   * Get a specific model by ID.
   */
  async getModel(modelId: string): Promise<
    | { id: string; object: string; created: number; ownedBy: string }
    | undefined
  > {
    try {
      const model = await this.openai.models.retrieve(modelId);
      return {
        id: model.id,
        object: model.object,
        created: model.created,
        ownedBy: model.owned_by,
      };
    } catch {
      return undefined;
    }
  }

  // ─── Health check ─────────────────────────────────────────────────────────

  /**
   * Check if the API endpoint is reachable.
   */
  async healthCheck(): Promise<{
    status: 'ok' | 'error';
    message?: string;
    modelCount?: number;
    latencyMs?: number;
  }> {
    const startTime = Date.now();
    try {
      const models = await this.listModels();
      const latencyMs = Date.now() - startTime;
      return {
        status: 'ok',
        modelCount: models.length,
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        status: 'error',
        message,
        latencyMs,
      };
    }
  }

  // ─── Configuration ────────────────────────────────────────────────────────

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
    // OpenAI SDK requires an API key even for local endpoints.
    const apiKey = config.apiKey || 'ollama';
    // Ensure the base URL includes /v1 for Ollama compatibility
    const baseUrl = config.baseUrl.endsWith('/v1')
      ? config.baseUrl
      : config.baseUrl.replace(/\/api$/, '/v1');
    this.openai = new OpenAI({
      baseURL: baseUrl,
      apiKey,
      defaultHeaders: config.apiKey
        ? { Authorization: `Bearer ${config.apiKey}` }
        : undefined,
      maxRetries: 1,
    });
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Build the messages array from prompt data.
   */
  private buildMessages(data: PromptRunWithExtraParams): ChatCompletionMessageParam[] {
    const messages: ChatCompletionMessageParam[] = [];

    if (data.systemPrompt) {
      messages.push({ role: 'system', content: data.systemPrompt });
    }

    messages.push({ role: 'user', content: data.input });

    return messages;
  }

  /**
   * Build extra parameters for the API call.
   */
  private buildExtraParams(data: PromptRunWithExtraParams): Partial<ExtraParams> {
    if (!data.extraParams) return {};
    return data.extraParams;
  }

  /**
   * Build partial metadata from a stream chunk.
   */
  private buildPartialMetadata(
    chunk: OpenAI.ChatCompletionChunk,
  ): APIResponseMetadata {
    return {
      id: chunk.id ?? crypto.randomUUID(),
      model: chunk.model ?? '',
      createdAt: chunk.created
        ? new Date(chunk.created * 1000).toISOString()
        : new Date().toISOString(),
    };
  }

  /**
   * Save a run to the database.
   */
  private async saveRun(
    data: PromptRunCreate & {
      tokenCount: number;
      latencyMs: number;
      cost?: number;
    },
    output: string,
  ): Promise<void> {
    try {
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
    } catch (err) {
      // Silently ignore FK constraint errors — the API call succeeded,
      // the DB just doesn't have the referenced prompt/version records.
      if (err instanceof Error && (err as any).code !== 'SQLITE_CONSTRAINT') {
        console.warn('Failed to save run to DB:', err);
      }
    }
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
}
