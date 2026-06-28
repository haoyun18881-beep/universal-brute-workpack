const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /Authorization\s*[:=]\s*[^\s"'`]+/gi,
  /(api[_-]?key|token|cookie|password|secret)\s*[:=]\s*["']?[^"'\s]{8,}/gi,
  /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/g,
];

export function redact(value) {
  let text = String(value ?? '');
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (match, name) => (name ? `${name}=<redacted>` : '<redacted-secret>'));
  }
  return text;
}

export function truncate(value, limit = 60000) {
  const text = redact(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n...[truncated ${text.length - limit} chars]`;
}
