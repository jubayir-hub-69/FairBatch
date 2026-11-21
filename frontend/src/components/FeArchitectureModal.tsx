import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Code2,
  Cpu,
  FileCode2,
  Lock,
  Scale,
  ShieldCheck,
  X,
} from 'lucide-react';
import { VERIFIED_FE_FEATURES } from '../lib/glossary';

interface FeArchitectureModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FeArchitectureModal: React.FC<FeArchitectureModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTabId, setActiveTabId] = useState<string>(VERIFIED_FE_FEATURES[0].id);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const currentTab =
    VERIFIED_FE_FEATURES.find((t) => t.id === activeTabId) ?? VERIFIED_FE_FEATURES[0];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="fe-arch-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto border border-ink bg-paper-bright shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b-2 border-ink bg-paper px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-ink bg-ink text-paper">
              <Code2 className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <div className="eyebrow">Verified Fe 26.5.0 contracts</div>
              <h2
                id="fe-arch-modal-title"
                className="mt-1 font-display text-xl font-bold leading-tight text-ink"
              >
                Why Fe 26.5.0?
              </h2>
              <p className="mt-1 text-sm text-ink-muted">
                Every feature below maps directly to compiled Fe modules in <code>src/</code>.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Why Fe modal"
            className="tap-target inline-flex w-11 items-center justify-center border border-rule-strong text-ink-muted transition hover:border-ink hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5">
          <div className="grid grid-cols-1 gap-px border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
            {VERIFIED_FE_FEATURES.map((tab) => {
              const selected = tab.id === activeTabId;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTabId(tab.id)}
                  className={`tap-target relative px-3 py-2.5 text-left transition ${
                    selected
                      ? 'bg-ink text-paper'
                      : 'bg-paper-bright text-ink-muted hover:bg-paper-soft hover:text-ink'
                  }`}
                >
                  {selected && (
                    <span className="absolute inset-x-0 top-0 h-[2px] bg-vermilion-500" />
                  )}
                  <div className="font-display text-sm font-bold leading-tight">
                    {tab.label}
                  </div>
                  <div
                    className={`mt-1 font-mono text-xs ${
                      selected ? 'text-paper/80' : 'text-ink-faint'
                    }`}
                  >
                    {tab.filePath}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-l-2 border-vermilion-500 pl-3">
              <p className="text-sm leading-relaxed text-ink-soft">{currentTab.summary}</p>
              <span className="inline-flex items-center gap-1.5 border border-rule-strong bg-paper-soft px-2.5 py-1 font-mono text-xs font-bold text-ink">
                <FileCode2 className="h-3.5 w-3.5 text-cobalt-700" aria-hidden="true" />
                {currentTab.filePath}
              </span>
            </div>

            <div className="border border-ink bg-[#17180F] text-[#F3EFE4]">
              <div className="flex items-center justify-between gap-2 border-b border-white/15 px-3 py-2">
                <span className="font-mono text-xs font-bold uppercase tracking-label text-white/80">
                  {currentTab.filePath} — {currentTab.label}
                </span>
                <span className="font-mono text-xs text-white/70">{currentTab.badge}</span>
              </div>
              <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-[#C9E5D2]">
                <code>{currentTab.code}</code>
              </pre>
            </div>

            <div className="border border-rule bg-paper-soft p-4">
              <div className="mb-2 flex items-center gap-1.5 font-mono text-xs font-bold uppercase tracking-label text-ink-soft">
                <ShieldCheck className="h-4 w-4 text-pine-700" />
                <span>Verified contract guarantees</span>
              </div>
              <ul className="space-y-2">
                {currentTab.highlights.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2 text-sm leading-relaxed text-ink-soft"
                  >
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-pine-700" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid grid-cols-1 gap-px border border-rule bg-rule text-center sm:grid-cols-3">
              <div className="bg-paper-bright p-3">
                <Cpu className="mx-auto mb-1 h-4 w-4 text-pine-700" />
                <div className="font-display text-sm font-bold text-ink">Pure Pricing</div>
                <div className="mt-0.5 font-mono text-xs text-ink-muted">
                  src/clearing.fe · 0 uses
                </div>
              </div>
              <div className="bg-paper-bright p-3">
                <Scale className="mx-auto mb-1 h-4 w-4 text-cobalt-700" />
                <div className="font-display text-sm font-bold text-ink">Floor Solvency</div>
                <div className="mt-0.5 font-mono text-xs text-ink-muted">
                  src/math.fe · 512-bit mul_div
                </div>
              </div>
              <div className="bg-paper-bright p-3">
                <Lock className="mx-auto mb-1 h-4 w-4 text-brass-700" />
                <div className="font-display text-sm font-bold text-ink">Cancun Ready</div>
                <div className="mt-0.5 font-mono text-xs text-ink-muted">
                  src/lib.fe · EIP-1153 Mutex
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
