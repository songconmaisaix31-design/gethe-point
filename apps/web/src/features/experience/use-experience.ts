"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ExperienceClientError } from "./client";
import type {
  ExperienceActionId,
  ExperienceClient,
  ExperienceSnapshot,
} from "./model";

export interface ExperienceController {
  readonly snapshot: ExperienceSnapshot | null;
  readonly loading: boolean;
  readonly pendingActionId: ExperienceActionId | null;
  readonly error: ExperienceClientError | null;
  readonly perform: (actionId: ExperienceActionId) => void;
  readonly reload: () => void;
}

const normalizeError = (error: unknown): ExperienceClientError =>
  error instanceof ExperienceClientError
    ? error
    : new ExperienceClientError(
        "fixture_connection_interrupted",
        "客户端无法确认请求结果，已保留最后一次确认的服务端快照。",
        true,
      );

export const useExperience = (client: ExperienceClient): ExperienceController => {
  const [snapshot, setSnapshot] = useState<ExperienceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingActionId, setPendingActionId] = useState<ExperienceActionId | null>(null);
  const [error, setError] = useState<ExperienceClientError | null>(null);
  const activeRequestIdRef = useRef(0);
  const requestInFlightRef = useRef(true);

  const reload = useCallback((): void => {
    if (requestInFlightRef.current) {
      return;
    }

    requestInFlightRef.current = true;
    activeRequestIdRef.current += 1;
    const requestId = activeRequestIdRef.current;
    setLoading(true);
    setError(null);
    void client
      .load()
      .then((nextSnapshot) => {
        if (activeRequestIdRef.current === requestId) {
          setSnapshot(nextSnapshot);
        }
      })
      .catch((reason: unknown) => {
        if (activeRequestIdRef.current !== requestId) {
          return;
        }
        const nextError = normalizeError(reason);
        if (nextError.snapshot !== null) {
          setSnapshot(nextError.snapshot);
        }
        setError(nextError);
      })
      .finally(() => {
        if (activeRequestIdRef.current === requestId) {
          requestInFlightRef.current = false;
          setLoading(false);
        }
      });
  }, [client]);

  useEffect(() => {
    let active = true;
    requestInFlightRef.current = true;
    activeRequestIdRef.current += 1;
    const requestId = activeRequestIdRef.current;
    void client
      .load()
      .then((nextSnapshot) => {
        if (active && activeRequestIdRef.current === requestId) {
          setSnapshot(nextSnapshot);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (active && activeRequestIdRef.current === requestId) {
          const nextError = normalizeError(reason);
          if (nextError.snapshot !== null) {
            setSnapshot(nextError.snapshot);
          }
          setError(nextError);
        }
      })
      .finally(() => {
        if (active && activeRequestIdRef.current === requestId) {
          requestInFlightRef.current = false;
          setLoading(false);
        }
      });

    return () => {
      active = false;
      if (activeRequestIdRef.current === requestId) {
        activeRequestIdRef.current += 1;
        requestInFlightRef.current = false;
      }
    };
  }, [client]);

  const perform = useCallback(
    (actionId: ExperienceActionId): void => {
      if (
        snapshot === null ||
        loading ||
        pendingActionId !== null ||
        requestInFlightRef.current
      ) {
        return;
      }

      requestInFlightRef.current = true;
      activeRequestIdRef.current += 1;
      const requestId = activeRequestIdRef.current;
      setPendingActionId(actionId);
      setError(null);
      void client
        .perform(actionId)
        .then((nextSnapshot) => {
          if (activeRequestIdRef.current === requestId) {
            setSnapshot(nextSnapshot);
          }
        })
        .catch((reason: unknown) => {
          if (activeRequestIdRef.current !== requestId) {
            return;
          }
          const nextError = normalizeError(reason);
          if (nextError.snapshot !== null) {
            setSnapshot(nextError.snapshot);
          }
          setError(nextError);
        })
        .finally(() => {
          if (activeRequestIdRef.current === requestId) {
            requestInFlightRef.current = false;
            setPendingActionId(null);
          }
        });
    },
    [client, loading, pendingActionId, snapshot],
  );

  return {
    snapshot,
    loading,
    pendingActionId,
    error,
    perform,
    reload,
  };
};
