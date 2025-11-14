/**
 * Memory Bank Type Definitions
 *
 * Defines types for the memory bank system that stores institutional knowledge
 * across agent sessions. The MemoryAdapter interface enables future migration
 * from file-based storage (Phase 0.1a) to vector database (Phase 1.0+).
 */

/**
 * Core files in the memory bank system.
 * Each file serves a specific purpose for institutional knowledge.
 */
export enum MemoryFile {
  /** Architectural decisions, design patterns, component relationships */
  SystemPatterns = 'systemPatterns',

  /** Actual technologies used, development setup, constraints, integrations */
  TechContext = 'techContext',

  /** Current work focus, recent changes, priorities, active blockers */
  ActiveContext = 'activeContext',

  /** What works vs. planned, remaining work, feature status, technical debt */
  Progress = 'progress',
}

/**
 * Abstract storage interface for memory bank operations.
 *
 * Implementations:
 * - FileMemoryAdapter: File-based storage for Phase 0.1a-0.3
 * - VectorMemoryAdapter: Vector database storage for Phase 1.0+ (future)
 *
 * The adapter pattern allows swapping storage backends without changing
 * consumer code (MemoryBank service).
 */
export interface MemoryAdapter {
  /**
   * Read content from a specific memory file.
   * Returns default template content if file doesn't exist.
   */
  read(file: MemoryFile): Promise<string>;

  /**
   * Write content to a specific memory file.
   * Should use atomic operations (temp file + rename) for safety.
   */
  write(file: MemoryFile, content: string): Promise<void>;

  /**
   * Check if a memory file exists on disk/in storage.
   */
  exists(file: MemoryFile): Promise<boolean>;

  /**
   * Read all memory files at once.
   * More efficient than multiple individual reads.
   */
  readAll(): Promise<MemoryBankSnapshot>;

  /**
   * Write all memory files at once.
   * Useful for batch updates or restoring from backup.
   */
  writeAll(snapshot: MemoryBankSnapshot): Promise<void>;

  /**
   * Query memory files based on a question or keywords.
   *
   * File-based: Simple keyword matching
   * Vector DB: Semantic similarity search with rankings
   */
  query(question: string, options?: QueryOptions): Promise<MemoryQueryResult[]>;
}

/**
 * Complete snapshot of all memory files.
 * Used for batch operations, backups, or context loading.
 */
export interface MemoryBankSnapshot {
  systemPatterns: string;
  techContext: string;
  activeContext: string;
  progress: string;
  lastUpdated: Date;
}

/**
 * Options for querying the memory bank.
 */
export interface QueryOptions {
  /** Number of results to return (relevant for vector DB with rankings) */
  k?: number;

  /** Limit search to specific memory files */
  fileFilter?: MemoryFile[];
}

/**
 * Result from a memory bank query.
 */
export interface MemoryQueryResult {
  /** Which memory file contained this result */
  file: MemoryFile;

  /** Full content of the file */
  content: string;

  /** Relevance score (0-1, only for vector DB queries) */
  relevance?: number;

  /** Short excerpt showing match context */
  excerpt?: string;
}

/**
 * Context used to determine if memory bank should be updated.
 *
 * Based on Picatrix memory bank update triggers.
 */
export interface UpdateContext {
  /** New architectural pattern or design decision discovered */
  discoveredNewPattern: boolean;

  /** Major implementation completed (PR finished, feature added) */
  implementedMajorChange: boolean;

  /** Clarification received that should be documented */
  needsClarification: boolean;

  /** PR transitioned to completed state */
  prComplete: boolean;

  /** User explicitly requested memory update */
  userRequested: boolean;
}

/**
 * Configuration for vector database adapter (Phase 1.0+).
 * Not used by FileMemoryAdapter.
 */
export interface VectorDBConfig {
  /** Vector DB provider (chromadb, pinecone, weaviate, etc.) */
  provider: 'chromadb' | 'pinecone' | 'weaviate' | 'custom';

  /** Connection endpoint */
  endpoint: string;

  /** API key for hosted services */
  apiKey?: string;

  /** Collection/index name for storing embeddings */
  collectionName: string;

  /** Embedding model to use */
  embeddingModel: 'openai' | 'sentence-transformers' | 'custom';

  /** Embedding dimensions (e.g., 1536 for OpenAI ada-002) */
  embeddingDimensions: number;
}
