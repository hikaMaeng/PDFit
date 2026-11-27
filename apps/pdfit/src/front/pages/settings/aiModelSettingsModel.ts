import { isEmbeddingModel, type DefaultAiModels, type EmbeddingModel, type LanguageModelCandidate, type ModelChoice } from '@pdfit/pdfit/common/protocol/embedding-search';
import { readDefaultAiModels, selectDefaultAiModel, type AiServer } from '../../api/settings';

class SettingsModel {
  private readonly listeners = new Set<() => void>();
  private version = 0;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getVersion = () => this.version;
  protected emit() { this.version += 1; this.listeners.forEach((listener) => listener()); }
}

export class DefaultModelsModel extends SettingsModel {
  defaults: DefaultAiModels | null = null;
  pending = false;
  error = false;

  async load() {
    this.pending = true;
    this.emit();
    try { this.defaults = await readDefaultAiModels(); this.error = false; }
    catch { this.error = true; }
    finally { this.pending = false; this.emit(); }
  }

  async select(role: 'llm' | 'embedding', choice: ModelChoice | null) {
    if (this.pending) return;
    this.pending = true;
    this.error = false;
    this.emit();
    try { this.defaults = await selectDefaultAiModel(role, choice); }
    catch { this.error = true; }
    finally { this.pending = false; this.emit(); }
  }
}

export class CandidateDraft extends SettingsModel {
  llm: LanguageModelCandidate[] = [];
  embedding: EmbeddingModel[] = [];
  private legacyEmbedding = '';

  reset(server?: AiServer | null) {
    this.llm = [...(server?.llmCandidates ?? [])];
    this.embedding = [...(server?.embeddingCandidates ?? [])];
    this.legacyEmbedding = server?.models.embedding ?? '';
    this.emit();
  }

  addLlm() { this.llm.push({ name: '' }); this.emit(); }
  setLlm(index: number, name: string) { this.llm[index] = { ...this.llm[index], name }; this.emit(); }
  removeLlm(index: number) { this.llm.splice(index, 1); this.emit(); }

  addEmbedding() {
    this.embedding.push({ name: this.embedding.length ? '' : this.legacyEmbedding, dimensions: 0, indexDimensions: 0,
      embeddingConcurrency: 1, maxInputTokens: 512, matryoshka: false, revision: '', documentPrefix: '', queryPrefix: '' });
    this.emit();
  }

  setEmbedding(index: number, values: Partial<EmbeddingModel>) {
    this.embedding[index] = { ...this.embedding[index], ...values };
    this.emit();
  }

  removeEmbedding(index: number) { this.embedding.splice(index, 1); this.emit(); }

  get valid() { return this.llm.every(({ name }) => name.trim() && name.length <= 300) && this.embedding.every(isEmbeddingModel); }
}
