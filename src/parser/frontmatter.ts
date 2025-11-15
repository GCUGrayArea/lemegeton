/**
 * YAML frontmatter extraction and reconstruction
 */

import * as yaml from 'js-yaml';
import { PRBlock, PRData } from './types';
import { ParseError, StructureError } from './errors';

const FRONTMATTER_DELIMITER = '---';

/**
 * Extract all PR blocks from task list content
 */
export function extractFrontmatter(content: string): PRBlock[] {
  const lines = content.split('\n');
  const blocks: PRBlock[] = [];
  let currentBlock: string[] = [];
  let inFrontmatter = false;
  let startLine = -1;
  let blockCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim() === FRONTMATTER_DELIMITER) {
      if (!inFrontmatter) {
        // Start of frontmatter
        inFrontmatter = true;
        startLine = i;
        currentBlock = [];
      } else {
        // End of frontmatter
        inFrontmatter = false;
        blockCount++;

        try {
          const frontmatter = currentBlock.join('\n');
          const data = parsePRBlock(frontmatter, startLine);

          // Only add if it has a pr_id (valid PR block)
          if (data.pr_id) {
            blocks.push({
              prId: data.pr_id,
              frontmatter,
              data,
              startLine,
              endLine: i,
            });
          }
        } catch (error) {
          // Skip blocks that don't parse as valid PRs (like markdown separators)
          if (error instanceof ParseError && error.message.includes('Invalid YAML')) {
            // Ignore - not a PR block
          } else {
            throw error;
          }
        }

        currentBlock = [];
        startLine = -1;
      }
    } else if (inFrontmatter) {
      currentBlock.push(line);
    }
  }

  if (inFrontmatter) {
    throw new StructureError(
      'Unclosed frontmatter block',
      ['Ensure all frontmatter blocks have closing --- delimiter']
    );
  }

  if (blocks.length === 0) {
    throw new StructureError(
      'No frontmatter blocks found in task list',
      [
        'Task list should contain PR blocks with YAML frontmatter',
        'Format: ---\\npr_id: PR-XXX\\n...\\n---'
      ]
    );
  }

  return blocks;
}

/**
 * Parse a single PR block from YAML
 */
export function parsePRBlock(block: string, startLine: number = 0): PRData {
  try {
    const parsed = yaml.load(block);

    if (!parsed || typeof parsed !== 'object') {
      throw new ParseError(
        'Invalid YAML: expected object',
        undefined,
        startLine
      );
    }

    return parsed as PRData;
  } catch (error) {
    if (error instanceof yaml.YAMLException) {
      throw new ParseError(
        `YAML parsing error: ${error.message}`,
        undefined,
        startLine + (error.mark?.line || 0),
        error.mark?.column,
        error.mark?.snippet
      );
    }
    throw error;
  }
}

/**
 * Serialize PR data back to YAML frontmatter
 */
export function serializePRBlock(data: PRData): string {
  try {
    return yaml.dump(data, {
      indent: 2,
      lineWidth: -1, // No line wrapping
      noRefs: true,
      sortKeys: false,
    });
  } catch (error) {
    throw new ParseError(
      `Failed to serialize PR ${data.pr_id}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Reconstruct full document with updated PR block
 */
export function reconstructDocument(
  content: string,
  prId: string,
  updatedData: PRData
): string {
  const lines = content.split('\n');
  const blocks = extractFrontmatter(content);

  const blockToUpdate = blocks.find(b => b.prId === prId);
  if (!blockToUpdate) {
    throw new ParseError(`PR ${prId} not found in task list`);
  }

  const newFrontmatter = serializePRBlock(updatedData);

  // Replace the lines between startLine and endLine
  const before = lines.slice(0, blockToUpdate.startLine + 1); // Include opening ---
  const after = lines.slice(blockToUpdate.endLine); // Include closing ---

  return [
    ...before,
    newFrontmatter.trim(),
    ...after
  ].join('\n');
}

/**
 * Add new PR block to document
 */
export function addPRBlock(content: string, data: PRData): string {
  const frontmatter = serializePRBlock(data);

  // Add at the end of the file
  return content + '\n\n' + FRONTMATTER_DELIMITER + '\n' +
         frontmatter.trim() + '\n' + FRONTMATTER_DELIMITER + '\n';
}
