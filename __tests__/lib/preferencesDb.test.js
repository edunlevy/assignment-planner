import {
  DEFAULT_RANKING,
  dbFetchPreferences,
  dbUpsertPreferences,
  isValidRanking,
} from '../../lib/preferencesDb';
import { supabase } from '../../lib/supabase';

// Same one-off chainable mock style as __tests__/lib/assignmentsDb.test.js.
function chainResolving({ data = null, error = null } = {}) {
  const settled = Promise.resolve({ data, error });
  const c = {};
  c.select = jest.fn(() => c);
  c.upsert = jest.fn(() => c);
  c.eq = jest.fn(() => c);
  c.single = jest.fn(() => settled);
  c.maybeSingle = jest.fn(() => settled);
  return c;
}

beforeEach(() => {
  supabase.from.mockReset();
});

describe('isValidRanking', () => {
  test('accepts any permutation of the three factors', () => {
    expect(isValidRanking(['dueDate', 'importance', 'complexity'])).toBe(true);
    expect(isValidRanking(['complexity', 'dueDate', 'importance'])).toBe(true);
  });

  test('rejects wrong length', () => {
    expect(isValidRanking(['dueDate', 'importance'])).toBe(false);
    expect(isValidRanking(['dueDate', 'importance', 'complexity', 'extra'])).toBe(false);
  });

  test('rejects duplicate entries', () => {
    expect(isValidRanking(['dueDate', 'dueDate', 'importance'])).toBe(false);
  });

  test('rejects unknown factor keys', () => {
    expect(isValidRanking(['dueDate', 'importance', 'notARealFactor'])).toBe(false);
  });

  test('rejects non-array input', () => {
    expect(isValidRanking(null)).toBe(false);
    expect(isValidRanking(undefined)).toBe(false);
    expect(isValidRanking('dueDate')).toBe(false);
  });
});

describe('dbFetchPreferences', () => {
  test('returns the ranking when a row exists', async () => {
    const chain = chainResolving({ data: { ranking: ['complexity', 'importance', 'dueDate'] } });
    supabase.from.mockReturnValue(chain);
    const result = await dbFetchPreferences('user-1');
    expect(supabase.from).toHaveBeenCalledWith('user_preferences');
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(result).toEqual(['complexity', 'importance', 'dueDate']);
  });

  test('returns null when no row exists', async () => {
    const chain = chainResolving({ data: null });
    supabase.from.mockReturnValue(chain);
    const result = await dbFetchPreferences('user-1');
    expect(result).toBeNull();
  });

  test('throws on a DB error', async () => {
    const chain = chainResolving({ error: { message: 'boom' } });
    supabase.from.mockReturnValue(chain);
    await expect(dbFetchPreferences('user-1')).rejects.toEqual({ message: 'boom' });
  });
});

describe('dbUpsertPreferences', () => {
  test('upserts a valid ranking and returns the saved value', async () => {
    const chain = chainResolving({ data: { ranking: DEFAULT_RANKING } });
    supabase.from.mockReturnValue(chain);
    const result = await dbUpsertPreferences('user-1', DEFAULT_RANKING);
    expect(supabase.from).toHaveBeenCalledWith('user_preferences');
    expect(chain.upsert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1',
      ranking: DEFAULT_RANKING,
    }));
    expect(result).toEqual(DEFAULT_RANKING);
  });

  test('rejects an invalid ranking without calling supabase', async () => {
    await expect(dbUpsertPreferences('user-1', ['dueDate'])).rejects.toThrow('Invalid ranking');
    expect(supabase.from).not.toHaveBeenCalled();
  });

  test('throws on a DB error', async () => {
    const chain = chainResolving({ error: { message: 'boom' } });
    supabase.from.mockReturnValue(chain);
    await expect(dbUpsertPreferences('user-1', DEFAULT_RANKING)).rejects.toEqual({ message: 'boom' });
  });
});
