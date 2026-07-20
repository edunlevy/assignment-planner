// vi.mock is hoisted above the import of usePreferences by vitest. Mocking
// the lib/preferencesDb layer (rather than the supabase chain) keeps these
// tests focused on the hook's reconciliation logic.
vi.mock('../../lib/preferencesDb', () => ({
  DEFAULT_RANKING: ['dueDate', 'importance', 'complexity'],
  isValidRanking: ranking =>
    Array.isArray(ranking)
    && ranking.length === 3
    && new Set(ranking).size === 3
    && ['dueDate', 'importance', 'complexity'].every(f => ranking.includes(f)),
  dbFetchPreferences: vi.fn(),
  dbUpsertPreferences: vi.fn(),
}));

import { usePreferences } from '../../hooks/usePreferences';
import { dbFetchPreferences, dbUpsertPreferences } from '../../lib/preferencesDb';
import { renderHook, flushMicrotasks } from '../helpers/renderHook';
import { act } from 'react-test-renderer';

const USER_ID = 'user-1';
const DEFAULT_RANKING = ['dueDate', 'importance', 'complexity'];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('usePreferences', () => {
  test('starts with the default ranking and loaded=false before any userId', () => {
    const { result } = renderHook(() => usePreferences(null, undefined));
    expect(result.current.ranking).toEqual(DEFAULT_RANKING);
    expect(result.current.loaded).toBe(false);
  });

  test('adopts an existing DB row without upserting anything', async () => {
    const stored = ['complexity', 'importance', 'dueDate'];
    dbFetchPreferences.mockResolvedValue(stored);

    const { result } = renderHook(() => usePreferences(USER_ID, undefined));
    await flushMicrotasks();

    expect(result.current.ranking).toEqual(stored);
    expect(result.current.loaded).toBe(true);
    expect(dbUpsertPreferences).not.toHaveBeenCalled();
  });

  test('no DB row but valid sign-up metadata: adopts and persists it', async () => {
    const pending = ['importance', 'dueDate', 'complexity'];
    dbFetchPreferences.mockResolvedValue(null);
    dbUpsertPreferences.mockResolvedValue(pending);

    const { result } = renderHook(() => usePreferences(USER_ID, pending));
    await flushMicrotasks();

    expect(dbUpsertPreferences).toHaveBeenCalledWith(USER_ID, pending);
    expect(result.current.ranking).toEqual(pending);
    expect(result.current.loaded).toBe(true);
  });

  test('no DB row and no metadata (first-time social sign-in): falls back to default and persists it', async () => {
    dbFetchPreferences.mockResolvedValue(null);
    dbUpsertPreferences.mockResolvedValue(DEFAULT_RANKING);

    const { result } = renderHook(() => usePreferences(USER_ID, undefined));
    await flushMicrotasks();

    expect(dbUpsertPreferences).toHaveBeenCalledWith(USER_ID, DEFAULT_RANKING);
    expect(result.current.ranking).toEqual(DEFAULT_RANKING);
  });

  test('no DB row and invalid/malformed metadata: falls back to default', async () => {
    dbFetchPreferences.mockResolvedValue(null);
    dbUpsertPreferences.mockResolvedValue(DEFAULT_RANKING);
    const malformed = ['dueDate', 'dueDate', 'importance'];

    const { result } = renderHook(() => usePreferences(USER_ID, malformed));
    await flushMicrotasks();

    expect(dbUpsertPreferences).toHaveBeenCalledWith(USER_ID, DEFAULT_RANKING);
    expect(result.current.ranking).toEqual(DEFAULT_RANKING);
  });

  test('a fetch failure keeps the default ranking and still resolves loaded=true', async () => {
    dbFetchPreferences.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => usePreferences(USER_ID, undefined));
    await flushMicrotasks();

    expect(result.current.ranking).toEqual(DEFAULT_RANKING);
    expect(result.current.loaded).toBe(true);
  });

  test('direct account switch (user A -> user B, no intervening null): the previous user\'s ranking does not persist through a failed load for the new user', async () => {
    // Regression test: a direct switch between two signed-in accounts (no
    // sign-out in between) is reachable via App.js's deep-link handler,
    // which calls exchangeCodeForSession/setSession unconditionally for
    // whatever account a confirmation/recovery link belongs to. Without
    // resetting on every userId change (not just to-null), a new user
    // whose preferences fetch then fails would see the PREVIOUS user's
    // ranking still applied instead of falling back to the default.
    const USER_A = 'user-a';
    const USER_B = 'user-b';
    const rankingA = ['complexity', 'importance', 'dueDate'];
    dbFetchPreferences.mockResolvedValueOnce(rankingA);

    let currentUserId = USER_A;
    const { result, rerender } = renderHook(() => usePreferences(currentUserId, undefined));
    await flushMicrotasks();

    expect(result.current.ranking).toEqual(rankingA);

    dbFetchPreferences.mockRejectedValueOnce(new Error('network down'));
    currentUserId = USER_B;
    rerender();
    await flushMicrotasks();

    expect(result.current.ranking).toEqual(DEFAULT_RANKING);
  });

  test('savePreferences persists a new ranking and updates state', async () => {
    dbFetchPreferences.mockResolvedValue(DEFAULT_RANKING);
    const updated = ['complexity', 'dueDate', 'importance'];
    dbUpsertPreferences.mockResolvedValue(updated);

    const { result } = renderHook(() => usePreferences(USER_ID, undefined));
    await flushMicrotasks();

    await act(async () => {
      await result.current.savePreferences(updated);
    });

    expect(dbUpsertPreferences).toHaveBeenCalledWith(USER_ID, updated);
    expect(result.current.ranking).toEqual(updated);
  });

  test('savePreferences is a no-op for an invalid ranking', async () => {
    dbFetchPreferences.mockResolvedValue(DEFAULT_RANKING);
    const { result } = renderHook(() => usePreferences(USER_ID, undefined));
    await flushMicrotasks();

    await act(async () => {
      await result.current.savePreferences(['dueDate']);
    });

    expect(dbUpsertPreferences).not.toHaveBeenCalled();
    expect(result.current.ranking).toEqual(DEFAULT_RANKING);
  });
});
