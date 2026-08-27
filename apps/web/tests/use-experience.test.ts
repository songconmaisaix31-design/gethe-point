import type {
  DependencyList,
  Dispatch,
  EffectCallback,
  SetStateAction,
} from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MVP_CORE_DISPLAY } from "../src/features/experience/fixture-display";
import type {
  ExperienceClient,
  ExperienceSnapshot,
  ExperienceStage,
} from "../src/features/experience/model";

interface EffectSlot {
  readonly dependencies: DependencyList | undefined;
  readonly cleanup: (() => void) | undefined;
}

interface PendingEffect {
  readonly index: number;
  readonly dependencies: DependencyList | undefined;
  readonly effect: EffectCallback;
}

const dependenciesMatch = (
  previous: DependencyList | undefined,
  next: DependencyList | undefined,
): boolean => {
  if (previous === undefined || next === undefined) {
    return false;
  }
  return (
    previous.length === next.length &&
    previous.every((value, index) => Object.is(value, next[index]))
  );
};

const createHookRuntime = () => {
  const stateSlots: unknown[] = [];
  const refSlots: { current: unknown }[] = [];
  const effectSlots: (EffectSlot | undefined)[] = [];
  const pendingEffects: PendingEffect[] = [];
  let stateCursor = 0;
  let refCursor = 0;
  let effectCursor = 0;

  const reactModule = {
    useCallback: <Callback>(callback: Callback): Callback => callback,
    useEffect: (effect: EffectCallback, dependencies?: DependencyList): void => {
      const index = effectCursor;
      effectCursor += 1;
      const previous = effectSlots[index];
      if (previous === undefined || !dependenciesMatch(previous.dependencies, dependencies)) {
        pendingEffects.push({ dependencies, effect, index });
      }
    },
    useRef: <Value>(initialValue: Value): { current: Value } => {
      const index = refCursor;
      refCursor += 1;
      refSlots[index] ??= { current: initialValue };
      return refSlots[index] as { current: Value };
    },
    useState: <Value>(
      initialValue: Value | (() => Value),
    ): readonly [Value, Dispatch<SetStateAction<Value>>] => {
      const index = stateCursor;
      stateCursor += 1;
      if (!(index in stateSlots)) {
        stateSlots[index] =
          typeof initialValue === "function"
            ? (initialValue as () => Value)()
            : initialValue;
      }
      const setValue: Dispatch<SetStateAction<Value>> = (nextValue) => {
        const previousValue = stateSlots[index] as Value;
        stateSlots[index] =
          typeof nextValue === "function"
            ? (nextValue as (value: Value) => Value)(previousValue)
            : nextValue;
      };
      return [stateSlots[index] as Value, setValue] as const;
    },
  };

  const render = <Result>(hook: () => Result): Result => {
    stateCursor = 0;
    refCursor = 0;
    effectCursor = 0;
    const result = hook();
    const effectsToRun = pendingEffects.splice(0);
    for (const pending of effectsToRun) {
      effectSlots[pending.index]?.cleanup?.();
      const cleanup = pending.effect();
      effectSlots[pending.index] = {
        dependencies: pending.dependencies,
        cleanup: typeof cleanup === "function" ? cleanup : undefined,
      };
    }
    return result;
  };

  const cleanup = (): void => {
    for (const effect of effectSlots) {
      effect?.cleanup?.();
    }
  };

  return { cleanup, reactModule, render } as const;
};

const flushPromises = async (): Promise<void> => {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
  }
};

const deferred = <Value>() => {
  let resolvePromise: (value: Value | PromiseLike<Value>) => void = () => undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise } as const;
};

const experienceSnapshot = (
  revision: number,
  stage: ExperienceStage,
): ExperienceSnapshot => ({
  stage,
  stageTitle: stage,
  stageSummary: stage,
  report: null,
  server: {
    scenarioId: "mvp-core",
    revision,
    writeCount: revision,
    sharedWriteCount: 0,
    consent: stage === "consent" ? "pending" : "shared",
    sharedRows: 0,
    reportRows: 0,
    responsibilityOwners: {
      discoveredBy: MVP_CORE_DISPLAY.memberIds.subject,
      deadlineKeptBy: MVP_CORE_DISPLAY.memberIds.primary,
      scheduledBy: MVP_CORE_DISPLAY.memberIds.primary,
      executedBy: MVP_CORE_DISPLAY.memberIds.partner,
      followedUpBy: MVP_CORE_DISPLAY.memberIds.primary,
    },
    domainOwnerId: MVP_CORE_DISPLAY.memberIds.primary,
    futureReminderCount: 1,
    reminderOwnerId: MVP_CORE_DISPLAY.memberIds.primary,
    handover: {
      status: "blocked",
      fromConfirmed: false,
      toConfirmed: false,
    },
  },
});

afterEach(() => {
  vi.doUnmock("react");
  vi.resetModules();
});

describe("useExperience request serialization", () => {
  it("finishes a reload before accepting a command so its GET cannot overwrite the command", async () => {
    vi.resetModules();
    const runtime = createHookRuntime();
    vi.doMock("react", () => runtime.reactModule);
    const { useExperience } = await import("../src/features/experience/use-experience");
    const initial = experienceSnapshot(1, "consent");
    const reloaded = experienceSnapshot(1, "consent");
    const commanded = experienceSnapshot(2, "consent_recorded");
    const reloadResult = deferred<ExperienceSnapshot>();
    const commandResult = deferred<ExperienceSnapshot>();
    const load = vi
      .fn<ExperienceClient["load"]>()
      .mockResolvedValueOnce(initial)
      .mockReturnValueOnce(reloadResult.promise);
    const perform = vi
      .fn<ExperienceClient["perform"]>()
      .mockReturnValue(commandResult.promise);
    const client: ExperienceClient = { load, perform };

    let controller = runtime.render(() => useExperience(client));
    await flushPromises();
    controller = runtime.render(() => useExperience(client));
    expect(controller.snapshot?.server.revision).toBe(1);
    expect(controller.loading).toBe(false);

    controller.reload();
    controller.perform("record_share_consent");
    expect(perform).not.toHaveBeenCalled();

    controller = runtime.render(() => useExperience(client));
    expect(controller.loading).toBe(true);
    controller.perform("record_share_consent");
    expect(perform).not.toHaveBeenCalled();

    reloadResult.resolve(reloaded);
    await flushPromises();
    controller = runtime.render(() => useExperience(client));
    expect(controller.loading).toBe(false);

    controller.perform("record_share_consent");
    expect(perform).toHaveBeenCalledTimes(1);
    commandResult.resolve(commanded);
    await flushPromises();
    controller = runtime.render(() => useExperience(client));

    expect(controller.snapshot?.server.revision).toBe(2);
    expect(controller.pendingActionId).toBeNull();
    runtime.cleanup();
  });
});
