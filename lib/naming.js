'use strict';

const path = require('path');

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
 * Add the `rvi-` prefix to an icon name.
 * If the name already starts with the prefix, return it unchanged.
 *
 * @param {string} name
 * @param {string} [prefix='rvi']
 * @returns {string}
 */
function addPrefix(name, prefix = 'rvi') {
  const prefixWithDash = prefix + '-';
  if (name.startsWith(prefixWithDash)) return name;
  return prefixWithDash + name;
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

/**
 * Derive a final icon name from an SVG file path.
 *
 * Pipeline:
 *   1. Extract filename stem (no extension)
 *   2. Convert to kebab-case
 *   3. Add prefix
 *   4. Resolve duplicates if needed
 *
 * @param {string} svgPath
 * @param {Set<string>|Array<string>} existingNames
 * @param {object} [opts]
 * @param {string} [opts.prefix='rvi']
 * @param {boolean} [opts.allowDuplicate=true]
 * @returns {string}
 */
function deriveIconName(svgPath, existingNames = [], opts = {}) {
  const { prefix = 'rvi', allowDuplicate = true } = opts;

  const stem = path.basename(svgPath, path.extname(svgPath));
  const kebab = toKebabCase(stem);
  if (!kebab) return addPrefix('glyph', prefix);

  const prefixed = addPrefix(kebab, prefix);

  if (allowDuplicate) {
    return resolveDuplicate(prefixed, existingNames);
  }
  return prefixed;
}

module.exports = { toKebabCase, addPrefix, resolveDuplicate, deriveIconName };
