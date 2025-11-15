/**
 * Custom error types for task list parsing
 */

export class ParseError extends Error {
  constructor(
    message: string,
    public prId?: string,
    public line?: number,
    public column?: number,
    public snippet?: string
  ) {
    super(message);
    this.name = 'ParseError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public prId?: string,
    public field?: string,
    public errors?: string[]
  ) {
    super(message);
    this.name = 'ValidationError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class StructureError extends Error {
  constructor(
    message: string,
    public suggestions?: string[]
  ) {
    super(message);
    this.name = 'StructureError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class FileError extends Error {
  constructor(
    message: string,
    public filePath?: string,
    public code?: string
  ) {
    super(message);
    this.name = 'FileError';
    Error.captureStackTrace(this, this.constructor);
  }
}
