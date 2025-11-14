/**
 * Vector Memory Adapter (Phase 1.0+ - STUB)
 *
 * Future implementation using vector database for semantic search.
 * Currently throws "not implemented" errors - use FileMemoryAdapter for Phase 0.1a.
 *
 * Planned features:
 * - Vector database storage (ChromaDB, Pinecone, Weaviate, etc.)
 * - Semantic similarity search with relevance rankings
 * - Embedding generation for memory content
 * - Same MemoryAdapter interface for drop-in replacement
 *
 * Implementation timeline: Phase 1.0+ (after basic orchestration working)
 */

import {
  MemoryAdapter,
  MemoryFile,
  MemoryBankSnapshot,
  QueryOptions,
  MemoryQueryResult,
  VectorDBConfig,
} from '../types/memory';
import { FileMemoryAdapter } from './FileMemoryAdapter';

/**
 * Vector database client interface.
 * To be implemented based on chosen provider.
 */
interface VectorDBClient {
  search(embedding: number[], options: any): Promise<any[]>;
  upsert(doc: {
    id: string;
    embedding: number[];
    text: string;
    metadata: any;
  }): Promise<void>;
  delete(id: string): Promise<void>;
  collection(name: string): VectorDBClient;
}

/**
 * Embedding model interface.
 * To be implemented based on chosen provider (OpenAI, sentence-transformers, etc.).
 */
interface EmbeddingModel {
  embed(text: string): Promise<number[]>;
  batchEmbed(texts: string[]): Promise<number[][]>;
  dimensions: number;
}

/**
 * VectorMemoryAdapter provides semantic search capabilities for memory bank.
 *
 * **IMPLEMENTATION STATUS: STUB - NOT YET FUNCTIONAL**
 *
 * This is a stub implementation for Phase 1.0+. All methods throw
 * "not implemented" errors. Use FileMemoryAdapter for Phase 0.1a-0.3.
 *
 * When implementing:
 * 1. Choose vector DB provider (ChromaDB, Pinecone, Weaviate, etc.)
 * 2. Choose embedding model (OpenAI, sentence-transformers, etc.)
 * 3. Implement semantic search with k-NN
 * 4. Maintain file adapter fallback for writes
 * 5. Test with same test suite as FileMemoryAdapter
 *
 * @see FileMemoryAdapter for current working implementation
 */
export class VectorMemoryAdapter implements MemoryAdapter {
  private vectorDB?: VectorDBClient;
  private embedder?: EmbeddingModel;
  private fileAdapter: FileMemoryAdapter;
  private config: VectorDBConfig;

  /**
   * Create a new VectorMemoryAdapter (stub).
   *
   * @param config - Vector database configuration
   * @param projectRoot - Project root for file fallback
   * @throws Error indicating this is not yet implemented
   */
  constructor(config: VectorDBConfig, projectRoot: string) {
    this.config = config;
    this.fileAdapter = new FileMemoryAdapter(projectRoot);

    throw new Error(
      'VectorMemoryAdapter not yet implemented (Phase 1.0+). ' +
        'Use FileMemoryAdapter for Phase 0.1a-0.3. ' +
        'See docs/ARCHITECTURE.md for migration timeline.'
    );
  }

  /**
   * Read memory file.
   *
   * **STUB**: Will delegate to file adapter in actual implementation.
   *
   * @throws Error - Not implemented
   */
  async read(file: MemoryFile): Promise<string> {
    throw new Error('VectorMemoryAdapter.read() not implemented');
    // Future implementation:
    // return this.fileAdapter.read(file);
  }

  /**
   * Write memory file and update vector DB.
   *
   * **STUB**: Will write to file adapter and update embeddings in actual implementation.
   *
   * @throws Error - Not implemented
   */
  async write(file: MemoryFile, content: string): Promise<void> {
    throw new Error('VectorMemoryAdapter.write() not implemented');
    // Future implementation:
    // await this.fileAdapter.write(file, content);
    // const embedding = await this.embedder!.embed(content);
    // await this.vectorDB!.upsert({
    //   id: file,
    //   embedding,
    //   text: content,
    //   metadata: { file, updatedAt: new Date() },
    // });
  }

  /**
   * Check if memory file exists.
   *
   * **STUB**: Will delegate to file adapter in actual implementation.
   *
   * @throws Error - Not implemented
   */
  async exists(file: MemoryFile): Promise<boolean> {
    throw new Error('VectorMemoryAdapter.exists() not implemented');
    // Future implementation:
    // return this.fileAdapter.exists(file);
  }

  /**
   * Read all memory files.
   *
   * **STUB**: Will delegate to file adapter in actual implementation.
   *
   * @throws Error - Not implemented
   */
  async readAll(): Promise<MemoryBankSnapshot> {
    throw new Error('VectorMemoryAdapter.readAll() not implemented');
    // Future implementation:
    // return this.fileAdapter.readAll();
  }

  /**
   * Write all memory files and update vector DB.
   *
   * **STUB**: Will write to file adapter and batch update embeddings in actual implementation.
   *
   * @throws Error - Not implemented
   */
  async writeAll(snapshot: MemoryBankSnapshot): Promise<void> {
    throw new Error('VectorMemoryAdapter.writeAll() not implemented');
    // Future implementation:
    // await this.fileAdapter.writeAll(snapshot);
    //
    // const embeddings = await this.embedder!.batchEmbed([
    //   snapshot.systemPatterns,
    //   snapshot.techContext,
    //   snapshot.activeContext,
    //   snapshot.progress,
    // ]);
    //
    // await Promise.all([
    //   this.vectorDB!.upsert({ id: 'systemPatterns', embedding: embeddings[0], ... }),
    //   this.vectorDB!.upsert({ id: 'techContext', embedding: embeddings[1], ... }),
    //   this.vectorDB!.upsert({ id: 'activeContext', embedding: embeddings[2], ... }),
    //   this.vectorDB!.upsert({ id: 'progress', embedding: embeddings[3], ... }),
    // ]);
  }

  /**
   * Query memory files with semantic similarity search.
   *
   * **STUB**: This is the key feature of VectorMemoryAdapter - semantic search vs. keyword matching.
   *
   * Planned behavior:
   * 1. Generate embedding for question
   * 2. Perform vector similarity search in DB
   * 3. Return ranked results with relevance scores
   *
   * Example query:
   * - Question: "how does coordination work between agents?"
   * - Returns: Relevant sections even without exact keyword matches
   * - Ranked by semantic relevance
   *
   * Compare to FileMemoryAdapter which uses simple keyword matching.
   *
   * @throws Error - Not implemented
   */
  async query(
    question: string,
    options?: QueryOptions
  ): Promise<MemoryQueryResult[]> {
    throw new Error('VectorMemoryAdapter.query() not implemented');

    // Future implementation:
    //
    // // 1. Generate embedding for question
    // const embedding = await this.embedder!.embed(question);
    //
    // // 2. Perform vector similarity search
    // const results = await this.vectorDB!.search(embedding, {
    //   k: options?.k || 5,
    //   filter: options?.fileFilter
    //     ? { file: { $in: options.fileFilter } }
    //     : undefined,
    // });
    //
    // // 3. Return ranked results with relevance scores
    // return results.map((result) => ({
    //   file: result.metadata.file as MemoryFile,
    //   content: result.text,
    //   relevance: result.score,
    //   excerpt: this.extractExcerpt(result.text, question),
    // }));
  }

  /**
   * Extract excerpt showing match context (placeholder).
   * Same as FileMemoryAdapter implementation.
   */
  private extractExcerpt(
    content: string,
    query: string,
    contextChars: number = 200
  ): string {
    // Same implementation as FileMemoryAdapter
    // ... (omitted for stub)
    return content.slice(0, contextChars) + '...';
  }
}

/**
 * Provider-specific implementations for future reference.
 *
 * These will be moved to separate files when actually implementing VectorMemoryAdapter.
 */

/**
 * ChromaDB client (example for future implementation)
 */
class ChromaDBClient implements VectorDBClient {
  constructor(endpoint: string) {
    throw new Error('ChromaDBClient not implemented');
  }

  async search(embedding: number[], options: any): Promise<any[]> {
    throw new Error('Not implemented');
  }

  async upsert(doc: any): Promise<void> {
    throw new Error('Not implemented');
  }

  async delete(id: string): Promise<void> {
    throw new Error('Not implemented');
  }

  collection(name: string): VectorDBClient {
    throw new Error('Not implemented');
  }
}

/**
 * OpenAI embeddings (example for future implementation)
 */
class OpenAIEmbedder implements EmbeddingModel {
  readonly dimensions = 1536; // ada-002

  constructor(apiKey: string) {
    throw new Error('OpenAIEmbedder not implemented');
  }

  async embed(text: string): Promise<number[]> {
    throw new Error('Not implemented');
  }

  async batchEmbed(texts: string[]): Promise<number[][]> {
    throw new Error('Not implemented');
  }
}

/**
 * Example usage (for documentation purposes):
 *
 * ```typescript
 * // Phase 1.0+ (not yet available)
 * const config: VectorDBConfig = {
 *   provider: 'chromadb',
 *   endpoint: 'http://localhost:8000',
 *   collectionName: 'lemegeton-memory',
 *   embeddingModel: 'openai',
 *   embeddingDimensions: 1536,
 * };
 *
 * const adapter = new VectorMemoryAdapter(config, projectRoot);
 * const memoryBank = new MemoryBank(adapter, redisClient);
 *
 * // Semantic search
 * const results = await memoryBank.query("how does coordination work?");
 * // Returns relevant sections ranked by semantic similarity
 * ```
 *
 * For Phase 0.1a-0.3, use FileMemoryAdapter:
 *
 * ```typescript
 * const adapter = new FileMemoryAdapter(projectRoot);
 * const memoryBank = new MemoryBank(adapter, redisClient);
 * ```
 */
