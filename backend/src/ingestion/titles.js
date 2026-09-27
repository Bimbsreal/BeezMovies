import { IngestionError } from './errors.js';

export function displayText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchingKey(value) {
  return displayText(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function slugify(value) {
  const slug = displayText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new IngestionError('MALFORMED_METADATA', 'A catalog name could not be assigned a slug', {
      transient: false,
    });
  }
  return slug;
}

export function canonicalGenre(name) {
  const displayName = assertPlainText(name, 'Genre');
  const key = matchingKey(displayName);
  if (key === 'scifi' || key === 'sciencefiction') {
    return { name: 'Science Fiction', slug: 'science-fiction' };
  }
  return { name: displayName, slug: slugify(displayName) };
}

export function assertPlainText(value, label) {
  const text = displayText(value);
  if (!text) {
    throw new IngestionError('MALFORMED_METADATA', `${label} is empty`, { transient: false });
  }
  if (/[<>]/.test(text)) {
    throw new IngestionError('MALFORMED_METADATA', `${label} contains markup`, { transient: false });
  }
  return text;
}
