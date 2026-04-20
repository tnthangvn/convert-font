'use strict';

const CHANNEL_PARAM_KEYS = ['channel', 'chanel'];
const CHANNEL_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function parseChannelUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('URL is required.');
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  let channel = null;
  for (const key of CHANNEL_PARAM_KEYS) {
    const value = parsed.searchParams.get(key);
    if (value && value.trim()) {
      channel = value.trim();
      break;
    }
  }

  if (!channel) {
    throw new Error('Missing channel id. Use ?channel=<id> or ?chanel=<id>.');
  }

  if (!CHANNEL_PATTERN.test(channel)) {
    throw new Error('Invalid channel id. Allowed: letters, numbers, dash, underscore.');
  }

  return {
    url: `${parsed.protocol}//${parsed.host}`,
    channel,
  };
}

function normalizeIconPayload(icons) {
  if (!Array.isArray(icons) || icons.length === 0) {
    throw new Error('icons must be a non-empty array.');
  }

  return icons.map((icon, index) => {
    if (!icon || typeof icon !== 'object') {
      throw new Error(`icons[${index}] must be an object.`);
    }

    const name = String(icon.name || '').trim();
    const svgContent = String(icon.svgContent || '').trim();

    if (!name) {
      throw new Error(`icons[${index}].name is required.`);
    }
    if (!svgContent || !svgContent.includes('<svg')) {
      throw new Error(`icons[${index}].svgContent must be a valid SVG string.`);
    }

    const clean = {
      name,
      svgContent,
    };

    if (typeof icon.codepoint === 'number' && Number.isInteger(icon.codepoint) && icon.codepoint > 0) {
      clean.codepoint = icon.codepoint;
    }

    return clean;
  });
}

module.exports = {
  parseChannelUrl,
  normalizeIconPayload,
};
