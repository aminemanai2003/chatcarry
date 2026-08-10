import { describe, expect, it } from 'vitest';
import { scanSensitiveText } from '../src/security';

describe('sensitive text warnings', () => {
  it('detects likely credentials without returning full values as samples', () => {
    const secret = 'ghp_abcdefghijklmnopqrstuvwxyz123456';
    const findings = scanSensitiveText(`token=${secret}`);
    expect(findings.some((finding) => finding.kind === 'GitHub token')).toBe(true);
    expect(findings.map((finding) => finding.sample).join(' ')).not.toContain(secret);
  });
});
