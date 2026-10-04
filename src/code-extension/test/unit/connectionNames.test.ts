import { describe, expect, it } from 'vitest';
import { isNameTaken, uniqueName } from '../../src/connections/connectionNames';

describe('isNameTaken', () => {
  it('ignores case and surrounding spaces', () => {
    expect(isNameTaken(['Prod'], ' prod ')).toBe(true);
    expect(isNameTaken(['Prod'], 'PROD')).toBe(true);
  });

  it('is false for a different name or an empty list', () => {
    expect(isNameTaken(['Prod'], 'Prod 2')).toBe(false);
    expect(isNameTaken([], 'Prod')).toBe(false);
  });
});

describe('uniqueName', () => {
  it('returns the base name when it is free', () => {
    expect(uniqueName(['Prod'], ' Local emulator ')).toBe('Local emulator');
  });

  it('adds the first free number', () => {
    expect(uniqueName(['Local emulator'], 'Local emulator')).toBe('Local emulator 2');
    expect(uniqueName(['Local emulator', 'local emulator 2'], 'Local emulator')).toBe('Local emulator 3');
  });
});
