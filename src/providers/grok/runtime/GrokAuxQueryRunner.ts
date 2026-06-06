import type { AuxQueryConfig, AuxQueryRunner } from '../../../core/auxiliary/AuxQueryRunner';
import type ClaudianPlugin from '../../../main';
import { runGrokHeadlessQuery } from './GrokHeadlessQueryRunner';

export class GrokAuxQueryRunner implements AuxQueryRunner {
  constructor(private readonly plugin: ClaudianPlugin) {}

  async query(config: AuxQueryConfig, prompt: string): Promise<string> {
    return runGrokHeadlessQuery({
      abortSignal: config.abortController?.signal,
      model: config.model,
      onTextDelta: (_delta, accumulated) => {
        config.onTextChunk?.(accumulated);
      },
      plugin: this.plugin,
      prompt,
      systemPrompt: config.systemPrompt,
    });
  }

  reset(): void {}
}
