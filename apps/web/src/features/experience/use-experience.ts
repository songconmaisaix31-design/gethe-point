"use client";

import { useCallback, useEffect, useState } from "react";

import { ExperienceClientError } from "./client";
import type {
  CanonicalScenarioActionId,
  ExperienceActionRequest,
  ExperienceClient,
  ExperienceSnapshot,
} from "./model";

export interface ExperienceController {
  readonly snapshot: ExperienceSnapshot | null;
  readonly loading: boolean;
  readonly pendingActionId: CanonicalScenarioActionId | null;
  readonly error: ExperienceClientError | null;
  readonly perform: (actionId: CanonicalScenarioActionId) => void;
  readonly retry: () => void;
  readonly reload: () => void;
}

const normalizeError = (error: unknown): ExperienceClientError => {
  if (error instanceof ExperienceClientError) {
    return error;
  }

  return new ExperienceClientError(
    "fixture_connection_interrupted",
    "连接短暂中断，本次操作没有提交。",
    true,
  );
};

export const useExperience = (client: ExperienceClient): ExperienceController => {
  const [snapshot, setSnapshot] = useState<ExperienceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingRequest, setPendingRequest] = useState<ExperienceActionRequest | null>(null);
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
        setError(normalizeError(reason));
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
          setLoading(false);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(normalizeError(reason));
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [client]);

  const execute = useCallback(
    (request: ExperienceActionRequest): void => {
      setPendingRequest(request);
      setError(null);
      void client
        .perform(request)
        .then((nextSnapshot) => {
          setSnapshot(nextSnapshot);
          setPendingRequest(null);
        })
        .catch((reason: unknown) => {
          setError(normalizeError(reason));
        });
    },
    [client],
  );

  const perform = useCallback(
    (actionId: CanonicalScenarioActionId): void => {
      if (snapshot === null || pendingRequest !== null) {
        return;
      }

      execute({ actionId, expectedRevision: snapshot.revision });
    },
    [execute, pendingRequest, snapshot],
  );

  const retry = useCallback((): void => {
    if (pendingRequest === null || error?.recoverable !== true) {
      return;
    }

    execute(pendingRequest);
  }, [error, execute, pendingRequest]);

  return {
    snapshot,
    loading,
    pendingActionId: pendingRequest?.actionId ?? null,
    error,
    perform,
    retry,
    reload,
  };
};
