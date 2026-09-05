import { describe, it, expect } from 'vitest';
import { classifySessionKeyError, generateEphemeralSessionKey } from './grant-session-key';

describe('grant-session-key helpers', () => {
  it('generateEphemeralSessionKey returns address matching private key', () => {
    const a = generateEphemeralSessionKey();
    const b = generateEphemeralSessionKey();
    expect(a.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(a.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(a.privateKey).not.toBe(b.privateKey);
    expect(a.address).not.toBe(b.address);
  });

  it('classifySessionKeyError maps wallet rejection', () => {
    expect(classifySessionKeyError(new Error('User rejected the request'))).toMatch(/rejected/i);
  });

  it('classifySessionKeyError maps missing API', () => {
    expect(classifySessionKeyError(new Error('Authorization endpoint not available (404)'))).toMatch(/API is missing|404/i);
  });
});
