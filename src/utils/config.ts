/**
 * Configuration Utilities
 *
 * Type-safe configuration merging utilities to eliminate duplicated
 * config merge patterns across the codebase.
 */

/**
 * Deep merge configuration objects with type safety.
 *
 * Recursively merges nested objects, with override values taking precedence.
 * Arrays are replaced entirely (not merged element-by-element).
 * Undefined values in overrides are ignored (defaults are preserved).
 *
 * @param defaults - Default configuration object
 * @param overrides - Partial override configuration
 * @returns Fully merged configuration object
 *
 * @example
 * ```typescript
 * const defaults = {
 *   redis: { url: 'localhost', port: 6379 },
 *   timeout: 5000
 * };
 * const overrides = { redis: { port: 6380 } };
 * const config = mergeConfig(defaults, overrides);
 * // Result: { redis: { url: 'localhost', port: 6380 }, timeout: 5000 }
 * ```
 */
export function mergeConfig<T extends Record<string, any>>(
  defaults: T,
  overrides: Partial<T>
): T {
  const result = { ...defaults };

  for (const key in overrides) {
    const override = overrides[key];
    const defaultValue = defaults[key];

    // Skip undefined overrides (preserve defaults)
    if (override === undefined) {
      continue;
    }

    // Deep merge nested objects
    if (
      override !== null &&
      typeof override === 'object' &&
      !Array.isArray(override) &&
      defaultValue !== null &&
      typeof defaultValue === 'object' &&
      !Array.isArray(defaultValue)
    ) {
      result[key] = mergeConfig(defaultValue, override) as T[Extract<keyof T, string>];
    } else {
      // Direct assignment for primitives, arrays, null, etc.
      result[key] = override as T[Extract<keyof T, string>];
    }
  }

  return result;
}

/**
 * Type guard to check if a value is a plain object (not null, array, or other type)
 */
function isPlainObject(value: unknown): value is Record<string, any> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Validate that all keys in overrides exist in defaults.
 * Useful for catching typos in configuration.
 *
 * @param defaults - Default configuration object
 * @param overrides - Override configuration
 * @param path - Current path for error messages (used internally)
 * @returns Array of invalid key paths
 *
 * @example
 * ```typescript
 * const defaults = { redis: { url: 'localhost' } };
 * const overrides = { redis: { urll: 'other' } }; // typo!
 * const errors = validateConfigKeys(defaults, overrides);
 * // Result: ['redis.urll']
 * ```
 */
export function validateConfigKeys<T extends Record<string, any>>(
  defaults: T,
  overrides: Partial<T>,
  path: string = ''
): string[] {
  const invalidKeys: string[] = [];

  for (const key in overrides) {
    const currentPath = path ? `${path}.${key}` : key;
    const override = overrides[key];
    const defaultValue = defaults[key];

    // Check if key exists in defaults
    if (!(key in defaults)) {
      invalidKeys.push(currentPath);
      continue;
    }

    // Recursively validate nested objects
    if (isPlainObject(override) && isPlainObject(defaultValue)) {
      invalidKeys.push(
        ...validateConfigKeys(defaultValue as Record<string, any>, override as Record<string, any>, currentPath)
      );
    }
  }

  return invalidKeys;
}

/**
 * Merge config with validation.
 * Throws an error if any invalid keys are found in overrides.
 *
 * @param defaults - Default configuration object
 * @param overrides - Partial override configuration
 * @returns Fully merged configuration object
 * @throws Error if overrides contain keys not present in defaults
 */
export function mergeConfigStrict<T extends Record<string, any>>(
  defaults: T,
  overrides: Partial<T>
): T {
  const invalidKeys = validateConfigKeys(defaults, overrides);

  if (invalidKeys.length > 0) {
    throw new Error(
      `Invalid configuration keys: ${invalidKeys.join(', ')}`
    );
  }

  return mergeConfig(defaults, overrides);
}
