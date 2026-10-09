import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  announceLocalStoragePreferenceChange,
  LOCAL_STORAGE_PREFERENCES_RESET_EVENT,
} from "../../storage/localPreferenceEvents";

interface LocalStorageStateOptions<T> {
  parse?: (value: unknown, fallback: T) => T;
  serialize?: (value: T) => unknown;
}

function readLocalStorageState<T>(
  key: string,
  fallback: T,
  parse: ((value: unknown, fallback: T) => T) | undefined,
): T {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    const parsed: unknown = JSON.parse(raw);
    return parse ? parse(parsed, fallback) : (parsed as T);
  } catch {
    return fallback;
  }
}

function writeLocalStorageState<T>(
  key: string,
  value: T,
  serialize: ((value: T) => unknown) | undefined,
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const serialized = JSON.stringify(serialize ? serialize(value) : value);
    if (window.localStorage.getItem(key) === serialized) {
      return;
    }
    window.localStorage.setItem(key, serialized);
  } catch {
    // UI preferences should not block the page when browser storage is unavailable.
  }
}

export function useLocalStorageState<T>(
  key: string,
  fallback: T,
  options: LocalStorageStateOptions<T> = {},
): [T, Dispatch<SetStateAction<T>>] {
  const { parse, serialize } = options;
  const [state, setState] = useState(() => readLocalStorageState(key, fallback, parse));
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const syncFromStorage = (): void => {
      const nextState = readLocalStorageState(key, fallback, parse);
      stateRef.current = nextState;
      setState(nextState);
    };
    const resetToDefault = (): void => {
      stateRef.current = fallback;
      writeLocalStorageState(key, fallback, serialize);
      setState(fallback);
    };

    syncFromStorage();
    window.addEventListener(LOCAL_STORAGE_PREFERENCES_RESET_EVENT, resetToDefault);
    return () => window.removeEventListener(LOCAL_STORAGE_PREFERENCES_RESET_EVENT, resetToDefault);
  }, [fallback, key, parse, serialize]);

  useEffect(() => {
    writeLocalStorageState(key, state, serialize);
  }, [key, serialize, state]);

  const setStoredState = useCallback<Dispatch<SetStateAction<T>>>((nextValue) => {
    const previousValue = stateRef.current;
    const resolvedValue = typeof nextValue === "function"
      ? (nextValue as (current: T) => T)(previousValue)
      : nextValue;
    stateRef.current = resolvedValue;
    setState(resolvedValue);
    if (!Object.is(previousValue, resolvedValue)) {
      announceLocalStoragePreferenceChange(key);
    }
  }, [key]);

  return [state, setStoredState];
}
