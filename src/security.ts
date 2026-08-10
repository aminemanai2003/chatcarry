export type SensitiveFinding = { kind: string; sample: string };

const detectors: Array<[string, RegExp]> = [
  ['OpenAI-style API key', /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['JWT', /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['Email address', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
  ['Phone number', /(?:\+?\d[\d .()-]{7,}\d)/g],
  ['Possible password or secret', /\b(?:password|passwd|secret|token)\s*[:=]\s*[^\s,;]{6,}/gi]
];

export function scanSensitiveText(text: string): SensitiveFinding[] {
  return detectors.flatMap(([kind, expression]) => [...text.matchAll(expression)].slice(0, 3).map((match) => ({
    kind,
    sample: `${match[0].slice(0, 6)}…${match[0].slice(-3)}`
  })));
}

export function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value, location.href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
