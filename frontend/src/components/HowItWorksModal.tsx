import React, { useEffect } from 'react';
import { BookOpen, X } from 'lucide-react';
import { HOW_IT_WORKS_STEPS } from '../lib/glossary';

interface HowItWorksModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HowItWorksModal: React.FC<HowItWorksModalProps> = ({ isOpen, onClose }) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="how-it-works-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto border border-ink bg-paper-bright shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b-2 border-ink bg-paper px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-ink bg-ink text-paper">
              <BookOpen className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <div className="eyebrow">4-step walkthrough</div>
              <h2
                id="how-it-works-title"
                className="mt-1 font-display text-xl font-bold leading-tight text-ink"
              >
                How FairBatch works
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close How it works modal"
            className="tap-target inline-flex w-11 items-center justify-center border border-rule-strong text-ink-muted transition hover:border-ink hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-sm leading-relaxed text-ink-soft">
            On a normal crypto exchange, fast bots can jump ahead of your swap and push the price
            against you. FairBatch groups everyone&apos;s orders into short rounds and settles them
            at one shared fair price.
          </p>

          <ol className="space-y-3">
            {HOW_IT_WORKS_STEPS.map((item) => (
              <li
                key={item.step}
                className="flex items-start gap-3 border border-rule bg-paper-soft p-3.5"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center border border-ink bg-ink font-mono text-xs font-bold text-paper">
                  {item.step}
                </span>
                <div className="min-w-0">
                  <h3 className="font-display text-base font-bold text-ink">{item.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-soft">{item.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="flex justify-end border-t border-rule pt-4">
            <button
              type="button"
              onClick={onClose}
              className="tap-target border border-ink bg-ink px-5 font-display text-sm font-bold text-paper transition hover:bg-ink-soft"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
