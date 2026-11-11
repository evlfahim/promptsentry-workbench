/**
 * Jest setup file — makes jest globals available in ESM mode.
 *
 * In Jest ESM mode, globals like jest, describe, test, expect are not
 * automatically available. Importing from @jest/globals registers them
 * as globals for all test files.
 */
import { jest } from '@jest/globals';

// Re-export as globals for all test files
globalThis.jest = jest;
