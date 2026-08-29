/**
 * Registry de Effect Executors — sin fallback silencioso (Fase 4.1).
 */

import {
  EFFECT_RESULT_CLASSIFICATIONS,
  type EffectExecutor,
  type EffectExecutorKind,
} from "@/lib/flow/executor-types";

export class UnknownExecutorKindError extends Error {
  readonly classification = EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED;

  constructor(public readonly kind: string) {
    super(`unknown_executor_kind:${kind}`);
    this.name = "UnknownExecutorKindError";
  }
}

export class ExecutorRegistry {
  private readonly executors = new Map<EffectExecutorKind, EffectExecutor>();

  register(executor: EffectExecutor): void {
    this.executors.set(executor.kind, executor);
  }

  resolve(kind: EffectExecutorKind): EffectExecutor {
    const executor = this.executors.get(kind);
    if (!executor) {
      throw new UnknownExecutorKindError(kind);
    }
    return executor;
  }

  has(kind: EffectExecutorKind): boolean {
    return this.executors.has(kind);
  }

  listKinds(): EffectExecutorKind[] {
    return [...this.executors.keys()];
  }
}
