import React from 'react';
import { Check } from 'lucide-react';
import type { SimpleStep } from '../../onchain/useFairBatch';

interface ProgressStripProps {
  currentStep: SimpleStep;
  hasTokens: boolean;
  hasActiveOrder: boolean;
  hasUnclaimed: boolean;
}

const STEPS: ReadonlyArray<{ id: SimpleStep; label: string; shortLabel: string }> = [
  { id: 1, label: 'Connect', shortLabel: 'Connect' },
  { id: 2, label: 'Test tokens', shortLabel: 'Tokens' },
  { id: 3, label: 'Swap', shortLabel: 'Swap' },
  { id: 4, label: 'Collect', shortLabel: 'Collect' },
];

export const ProgressStrip: React.FC<ProgressStripProps> = ({
  currentStep,
  hasTokens,
  hasActiveOrder,
  hasUnclaimed,
}) => {
  const isStepComplete = (step: SimpleStep): boolean => {
    if (step === 1) return currentStep > 1;
    if (step === 2) return currentStep > 2 || hasTokens;
    if (step === 3) return currentStep === 4 || hasUnclaimed;
    return false;
  };

  return (
    <nav
      aria-label="Swap progress"
      data-testid="simple-progress-strip"
      className="border border-rule bg-paper-bright px-2.5 py-2.5 sm:px-4 sm:py-3"
    >
      <ol className="grid grid-cols-4 gap-1.5 sm:gap-2">
        {STEPS.map((step) => {
          const active = currentStep === step.id;
          const done = !active && isStepComplete(step.id);
          const pendingRound = step.id === 3 && active && hasActiveOrder;

          return (
            <li
              key={step.id}
              aria-current={active ? 'step' : undefined}
              className={`flex min-w-0 flex-col items-center justify-center gap-1 border px-1.5 py-2 text-center sm:flex-row sm:justify-start sm:gap-2 sm:px-2.5 sm:text-left ${
                active
                  ? 'border-vermilion-600 bg-vermilion-50 text-vermilion-800'
                  : done
                    ? 'border-pine-600/40 bg-pine-50 text-pine-800'
                    : 'border-rule bg-paper-soft text-ink-muted'
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center font-mono text-xs font-bold ${
                  active
                    ? 'bg-vermilion-500 text-[#FBF8F0]'
                    : done
                      ? 'bg-pine-600 text-[#FBF8F0]'
                      : 'border border-rule-strong bg-paper-bright text-ink-muted'
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : step.id}
              </span>
              <div className="min-w-0">
                <span className="hidden text-xs font-bold leading-tight sm:block">
                  {step.label}
                </span>
                <span className="block text-xs font-bold leading-tight sm:hidden">
                  {step.shortLabel}
                </span>
                {pendingRound && (
                  <span className="hidden font-mono text-xs text-vermilion-700 md:block">
                    In round
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
