"use client";

import { useCallback, useEffect, useState } from "react";

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

  const reload = useCallback((): void => {
    setLoading(true);
    setError(null);
    void client
      .load()
      .then((nextSnapshot) => {
        setSnapshot(nextSnapshot);
      })
      .catch((reason: unknown) => {
        const nextError = normalizeError(reason);
        if (nextError.snapshot !== null) {
          setSnapshot(nextError.snapshot);
        }
        setError(nextError);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [client]);

  useEffect(() => {
    let active = true;
    void client
      .load()
      .then((nextSnapshot) => {
        if (active) {
          setSnapshot(nextSnapshot);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          const nextError = normalizeError(reason);
          if (nextError.snapshot !== null) {
            setSnapshot(nextError.snapshot);
          }
          setError(nextError);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [client]);

  const perform = useCallback(
    (actionId: ExperienceActionId): void => {
      if (snapshot === null || pendingActionId !== null) {
        return;
      }

      setPendingActionId(actionId);
      setError(null);
      void client
        .perform(actionId)
        .then((nextSnapshot) => {
          setSnapshot(nextSnapshot);
        })
        .catch((reason: unknown) => {
          const nextError = normalizeError(reason);
          if (nextError.snapshot !== null) {
            setSnapshot(nextError.snapshot);
          }
          setError(nextError);
        })
        .finally(() => {
          setPendingActionId(null);
        });
    },
    [client, pendingActionId, snapshot],
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
