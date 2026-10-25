import { describe, it, expect } from 'vitest';
import { makeCheckInCode, isCheckInCode, parseCheckIn, cleanCode, isLocalAddress, CODE_LENGTH } from './checkin';

describe('check-in codes', () => {
  it('makes 6-character codes without look-alike characters', () => {
    for (let i = 0; i < 200; i++) {
      const c = makeCheckInCode();
      expect(c).toHaveLength(CODE_LENGTH);
      expect(isCheckInCode(c)).toBe(true);
      expect(c).not.toMatch(/[01OIL]/);
    }
  });

  it('cleans what people type', () => {
    expect(cleanCode(' k7m-2qx ')).toBe('K7M2QX');
  });
});

describe('parseCheckIn', () => {
  it('reads the new short QR link', () => {
    expect(parseCheckIn('https://washflow.app/?c=K7M2QX')).toEqual({ code: 'K7M2QX' });
  });
  it('still reads old posters with ?checkin=<id>', () => {
    expect(parseCheckIn('https://washflow.app/?checkin=AbCdEf1234567890XyZq')).toEqual({ id: 'AbCdEf1234567890XyZq' });
  });
  it('reads a typed code', () => {
    expect(parseCheckIn('k7m 2qx')).toEqual({ code: 'K7M2QX' });
  });
  it('ignores QR codes that are not WashFlow check-ins', () => {
    expect(parseCheckIn('https://example.com/menu')).toBeNull();
    expect(parseCheckIn('hello')).toBeNull();
    expect(parseCheckIn('')).toBeNull();
  });
});

describe('isLocalAddress', () => {
  it('spots addresses a phone cannot open', () => {
    expect(isLocalAddress('http://localhost:3000')).toBe(true);
    expect(isLocalAddress('http://192.168.0.5:3000')).toBe(true);
    expect(isLocalAddress('https://washflow.vercel.app')).toBe(false);
  });
});
