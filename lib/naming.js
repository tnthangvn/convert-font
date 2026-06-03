'use strict';

/**
 * Convert a string to kebab-case.
 * Handles camelCase, PascalCase, snake_case, spaces, and mixed separators.
 *
 * @param {string} str
 * @returns {string}
 */
function toKebabCase(str) {
  return str
    // Insert hyphen before uppercase letters in camelCase/PascalCase
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    // Replace underscores, spaces, dots, and other separators with hyphens
    .replace(/[_\s.]+/g, '-')
    // Remove any characters that aren't alphanumeric or hyphens
    .replace(/[^a-zA-Z0-9-]/g, '')
    // Collapse multiple hyphens
    .replace(/-+/g, '-')
    // Trim leading/trailing hyphens
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/**
 * Resolve a duplicate icon name by appending a numeric suffix.
 *
 * If `baseName` does not exist in `existingNames`, returns `baseName`.
 * Otherwise, tries `baseName-1`, `baseName-2`, etc. until a unique name is found.
 *
 * @param {string} baseName
 * @param {Set<string>|Array<string>} existingNames
 * @returns {string}
 */
function resolveDuplicate(baseName, existingNames) {
  const nameSet = existingNames instanceof Set ? existingNames : new Set(existingNames);
  if (!nameSet.has(baseName)) return baseName;

  let suffix = 1;
  while (nameSet.has(`${baseName}-${suffix}`)) {
    suffix++;
  }
  return `${baseName}-${suffix}`;
}

module.exports = { toKebabCase, resolveDuplicate };
