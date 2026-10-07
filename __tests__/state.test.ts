import * as core from '@actions/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearKiroPid, getKiroPid, saveKiroPid } from '../src/state.js';

vi.mock('@actions/core', () => ({
  getState: vi.fn(),
  saveState: vi.fn(),
}));

const getState = vi.mocked(core.getState);
const saveState = vi.mocked(core.saveState);
const state = new Map<string, string>();

beforeEach(() => {
  vi.clearAllMocks();
  state.clear();
  getState.mockImplementation((name: string) => state.get(name) ?? '');
  saveState.mockImplementation((name: string, value: string) => {
    state.set(name, value);
  });
});

describe('main-to-post state', () => {
  it('round trips and clears the Kiro PID', () => {
    saveKiroPid(1234);

    expect(getKiroPid()).toBe(1234);

    clearKiroPid();

    expect(getKiroPid()).toBeUndefined();
  });

  it.each(['4.2', '1', '99999999999999999999'])('rejects invalid Kiro PID state %j', (value) => {
    getState.mockReturnValue(value);

    expect(getKiroPid()).toBeUndefined();
  });

  it('accepts safe Kiro PID state at the lower boundary', () => {
    getState.mockReturnValue('2');

    expect(getKiroPid()).toBe(2);
  });
});
