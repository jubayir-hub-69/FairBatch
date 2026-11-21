import React, { useMemo, useState } from 'react';
import { Crosshair, GitMerge, Info } from 'lucide-react';
import type { BatchSettlementDto, CurvePointDto } from '../types';
import { formatPrice, formatToken } from '../lib/format';
import { PRO_TOOLTIPS } from '../lib/glossary';
import { InfoTooltip } from './InfoTooltip';

interface PriceChartProps {
  settlement: BatchSettlementDto;
  isLivePreview: boolean;
  baseSymbol: string;
  quoteSymbol: string;
}

interface HoverNode {
  kind: 'Supply' | 'Demand' | 'Equilibrium';
  price: number;
  baseVol: number;
  quoteVol: number;
  x: number;
  y: number;
  note: string;
}

function dedupeTiers(points: CurvePointDto[]): CurvePointDto[] {
  const out: CurvePointDto[] = [];
  for (const pt of points) {
    const prev = out[out.length - 1];
    if (
      prev &&
      Math.abs(prev.price - pt.price) < 1e-6 &&
      Math.abs(prev.cumulative_base - pt.cumulative_base) < 1e-6
    ) {
      continue;
    }
    if (prev && Math.abs(prev.price - pt.price) < 1e-6) {
      out[out.length - 1] = pt;
    } else {
      out.push(pt);
    }
  }
  return out;
}

export const PriceChart: React.FC<PriceChartProps> = ({
  settlement,
  isLivePreview,
  baseSymbol,
  quoteSymbol,
}) => {
  const [hovered, setHovered] = useState<HoverNode | null>(null);

  const width = 780;
  const height = 340;
  const pad = { top: 26, right: 32, bottom: 44, left: 72 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const chartData = useMemo(() => {
    const supplyTiers = dedupeTiers(
      settlement.supply_curve.filter((p) => p.cumulative_base > 0),
    );
    const demandTiers = dedupeTiers(
      settlement.demand_curve.filter((p) => p.cumulative_base > 0),
    );

    const spot0 = settlement.reserves_before.spot_price || 3000;
    const pStar = settlement.clearing_price || spot0;

    const allPrices: number[] = [spot0, pStar];
    for (const s of supplyTiers) if (s.price > 0) allPrices.push(s.price);
    for (const d of demandTiers) if (d.price > 0) allPrices.push(d.price);

    const rawMinP = Math.min(...allPrices);
    const rawMaxP = Math.max(...allPrices);
    const priceSpan = Math.max(250, rawMaxP - rawMinP);
    const yMin = Math.max(0, Math.floor((rawMinP - priceSpan * 0.22) / 50) * 50);
    const yMax = Math.ceil((rawMaxP + priceSpan * 0.22) / 50) * 50;

    const maxSupplyBase =
      supplyTiers.length > 0
        ? supplyTiers[supplyTiers.length - 1].cumulative_base
        : 0;
    const maxDemandBase =
      demandTiers.length > 0
        ? demandTiers[demandTiers.length - 1].cumulative_base
        : 0;
    const eqBase = Math.max(
      settlement.total_sell_base_eligible,
      pStar > 0 ? settlement.total_buy_quote_eligible / pStar : 0,
    );

    const xMax = Math.max(4, Math.max(maxSupplyBase, maxDemandBase, eqBase) * 1.25);

    const toX = (baseQty: number) =>
      pad.left + Math.min(1, Math.max(0, baseQty / xMax)) * plotW;
    const toY = (price: number) =>
      pad.top +
      (1 - Math.min(1, Math.max(0, (price - yMin) / Math.max(1, yMax - yMin)))) *
        plotH;

    // Build upward step path for Seller Supply S(p)
    let supplyPath = '';
    if (supplyTiers.length > 0) {
      let prevQ = 0;
      supplyTiers.forEach((tier, idx) => {
        const x0 = toX(prevQ);
        const x1 = toX(tier.cumulative_base);
        const y = toY(tier.price);
        if (idx === 0) {
          supplyPath += `M ${x0.toFixed(1)} ${y.toFixed(1)} L ${x1.toFixed(1)} ${y.toFixed(1)}`;
        } else {
          supplyPath += ` L ${x0.toFixed(1)} ${y.toFixed(1)} L ${x1.toFixed(1)} ${y.toFixed(1)}`;
        }
        prevQ = tier.cumulative_base;
      });
      supplyPath += ` L ${toX(prevQ).toFixed(1)} ${toY(yMax).toFixed(1)}`;
    }

    // Build downward step path for Buyer Demand D(p)
    let demandPath = '';
    if (demandTiers.length > 0) {
      let prevQ = 0;
      demandTiers.forEach((tier, idx) => {
        const x0 = toX(prevQ);
        const x1 = toX(tier.cumulative_base);
        const y = toY(tier.price);
        if (idx === 0) {
          demandPath += `M ${x0.toFixed(1)} ${y.toFixed(1)} L ${x1.toFixed(1)} ${y.toFixed(1)}`;
        } else {
          demandPath += ` L ${x0.toFixed(1)} ${y.toFixed(1)} L ${x1.toFixed(1)} ${y.toFixed(1)}`;
        }
        prevQ = tier.cumulative_base;
      });
      demandPath += ` L ${toX(prevQ).toFixed(1)} ${toY(yMin).toFixed(1)}`;
    }

    // Build smooth Hybrid FM-AMM + Buyer Absorption curve:
    // At price p, net Base capacity absorbed by (Pool + ITM Buyers) = max(0, ((R_y + 2*D_y(p))/p - R_x) / 2)
    const rx = settlement.reserves_before.rx;
    const ry = settlement.reserves_before.ry;
    let hybridPoolDemandPath = '';
    if (rx > 0 || ry > 0) {
      const samples = 36;
      for (let i = 0; i <= samples; i++) {
        const pSample = yMax - ((yMax - Math.max(100, yMin)) * i) / samples;
        const dQuoteAtP = demandTiers.reduce((acc, t) => {
          return t.price >= pSample - 1e-6 ? Math.max(acc, t.cumulative_quote ?? 0) : acc;
        }, 0);
        const absorbedBase = Math.max(0, ((ry + 2 * dQuoteAtP) / pSample - rx) / 2);
        const sx = toX(absorbedBase);
        const sy = toY(pSample);
        hybridPoolDemandPath += `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `;
      }
    }

    return {
      supplyTiers,
      demandTiers,
      spot0,
      pStar,
      eqBase,
      yMin,
      yMax,
      xMax,
      toX,
      toY,
      supplyPath,
      demandPath,
      hybridPoolDemandPath,
    };
  }, [settlement, plotW, plotH, pad.left, pad.top]);

  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    const count = 4;
    for (let i = 0; i <= count; i++) {
      ticks.push(
        chartData.yMin + ((chartData.yMax - chartData.yMin) * i) / count,
      );
    }
    return ticks;
  }, [chartData.yMin, chartData.yMax]);

  const xTicks = useMemo(() => {
    const ticks: number[] = [];
    const count = 4;
    for (let i = 0; i <= count; i++) {
      ticks.push((chartData.xMax * i) / count);
    }
    return ticks;
  }, [chartData.xMax]);

  const eqX = chartData.toX(chartData.eqBase);
  const eqY = chartData.toY(chartData.pStar);
  const cowX = chartData.toX(settlement.cow_matched_base);
  const spotY = chartData.toY(chartData.spot0);

  return (
    <section
      aria-label="Supply Demand Depth and Uniform Clearing Price Chart"
      className="ledger-panel overflow-hidden"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-rule px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow flex items-center gap-1.5">
              <Crosshair className="h-3.5 w-3.5 text-vermilion-600" aria-hidden="true" />
              <span>Clearing chart</span>
              <InfoTooltip label="Clearing price p*" text={PRO_TOOLTIPS.pStar} />
            </span>
            <span
              className={`border px-2 py-0.5 font-mono text-xs font-bold uppercase ${
                isLivePreview
                  ? 'border-cobalt-600/40 bg-cobalt-50 text-cobalt-700'
                  : 'border-pine-600/40 bg-pine-50 text-pine-700'
              }`}
            >
              {isLivePreview
                ? 'Current queue (live preview)'
                : `Settled · Batch #${settlement.batch_id}`}
            </span>
          </div>
          <h2 className="mt-1 font-display text-xl font-bold leading-tight tracking-tight text-ink">
            Supply, demand &amp; the clearing price
          </h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            Sorted seller supply S(p) × buyer demand D(p) + FM-AMM liquidity absorption.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1 font-mono text-xs uppercase text-ink-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 bg-pine-500" />
            <span>Supply S(p)</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 bg-cobalt-600" />
            <span>Demand D(p)</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-px w-3.5 border-t border-dashed border-plum-500" />
            <span>FM-AMM + demand</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 border border-pine-600/60 bg-pine-100" />
            <span>CoW P2P zone</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-vermilion-700 sm:hidden">
            <span className="h-px w-3.5 bg-vermilion-500" />
            <span>Swipe chart →</span>
          </span>
        </div>
      </div>

      {/* SVG canvas */}
      <div className="relative border-b border-rule bg-paper-bright">
        <div className="overflow-x-auto">
          <svg
            role="img"
            aria-label="Batch Supply and Demand Depth Chart"
            viewBox={`0 0 ${width} ${height}`}
            className="h-auto w-full min-w-[620px] select-none sm:min-w-0"
            onMouseLeave={() => setHovered(null)}
          >
          <defs>
            <linearGradient id="cowZoneGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3A7757" stopOpacity="0.20" />
              <stop offset="100%" stopColor="#3F63A4" stopOpacity="0.05" />
            </linearGradient>
            <linearGradient id="ammZoneGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#715494" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#715494" stopOpacity="0.03" />
            </linearGradient>
            <pattern id="ledgerGrid" width="7" height="7" patternUnits="userSpaceOnUse">
              <path d="M 7 0 L 0 0 0 7" fill="none" stroke="#EDE7D9" strokeWidth="0.6" />
            </pattern>
          </defs>

          <rect
            x={pad.left}
            y={pad.top}
            width={width - pad.left - pad.right}
            height={plotH}
            fill="url(#ledgerGrid)"
            stroke="#CFC7B4"
            strokeWidth="1"
          />

          {/* Grid lines */}
          {yTicks.map((pTick) => {
            const y = chartData.toY(pTick);
            return (
              <g key={`yt-${pTick}`}>
                <line
                  x1={pad.left}
                  y1={y}
                  x2={width - pad.right}
                  y2={y}
                  stroke="#DCD5C4"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
                <text
                  x={pad.left - 10}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-ink-muted font-mono text-[10px]"
                >
                  ${formatPrice(pTick, 0)}
                </text>
              </g>
            );
          })}

          {xTicks.map((xTick) => {
            const x = chartData.toX(xTick);
            return (
              <g key={`xt-${xTick}`}>
                <line
                  x1={x}
                  y1={pad.top}
                  x2={x}
                  y2={height - pad.bottom}
                  stroke="#DCD5C4"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
                <text
                  x={x}
                  y={height - pad.bottom + 16}
                  textAnchor="middle"
                  className="fill-ink-muted font-mono text-[10px]"
                >
                  {formatToken(xTick, 1, 1)} {baseSymbol}
                </text>
              </g>
            );
          })}

          {/* Shaded CoW peer-to-peer overlap zone */}
          {settlement.cow_matched_base > 0.001 && (
            <rect
              x={pad.left}
              y={pad.top}
              width={Math.max(0, cowX - pad.left)}
              height={plotH}
              fill="url(#cowZoneGrad)"
            />
          )}

          {/* Shaded FM-AMM net imbalance absorption zone */}
          {chartData.eqBase > settlement.cow_matched_base + 0.001 && (
            <rect
              x={cowX}
              y={pad.top}
              width={Math.max(0, eqX - cowX)}
              height={plotH}
              fill="url(#ammZoneGrad)"
            />
          )}

          {/* Pre-batch pool spot reference line */}
          <line
            x1={pad.left}
            y1={spotY}
            x2={width - pad.right}
            y2={spotY}
            stroke="#A9A089"
            strokeDasharray="5 5"
            strokeWidth="1"
          />
          <text
            x={width - pad.right - 4}
            y={spotY - 5}
            textAnchor="end"
            className="fill-ink-muted font-mono text-[9px]"
          >
            Pre-batch spot ${formatPrice(chartData.spot0, 2)}
          </text>

          {/* Hybrid FM-AMM + demand absorption curve */}
          {chartData.hybridPoolDemandPath && (
            <path
              d={chartData.hybridPoolDemandPath}
              fill="none"
              stroke="#715494"
              strokeWidth="1.75"
              strokeDasharray="5 4"
              opacity="0.85"
            />
          )}

          {/* Seller supply step curve S(p) */}
          {chartData.supplyPath && (
            <path
              d={chartData.supplyPath}
              fill="none"
              stroke="#3A7757"
              strokeWidth="2.75"
              strokeLinejoin="round"
            />
          )}

          {/* Buyer demand step curve D(p) */}
          {chartData.demandPath && (
            <path
              d={chartData.demandPath}
              fill="none"
              stroke="#2C4A8A"
              strokeWidth="2.75"
              strokeLinejoin="round"
            />
          )}

          {/* Uniform clearing price p* — the signature clearing rule */}
          <line
            x1={pad.left}
            y1={eqY}
            x2={width - pad.right}
            y2={eqY}
            stroke="#C6462B"
            strokeDasharray="7 3"
            strokeWidth="1.5"
          />
          <line
            x1={eqX}
            y1={pad.top}
            x2={eqX}
            y2={height - pad.bottom}
            stroke="#C6462B"
            strokeDasharray="7 3"
            strokeWidth="1.5"
          />

          {/* Interactive supply nodes */}
          {chartData.supplyTiers.map((tier, idx) => {
            const cx = chartData.toX(tier.cumulative_base);
            const cy = chartData.toY(tier.price);
            const isFilled = tier.price <= chartData.pStar + 1e-4;
            return (
              <circle
                key={`snode-${idx}`}
                cx={cx}
                cy={cy}
                r={4.5}
                className="cursor-pointer transition-all"
                fill={isFilled ? '#3A7757' : '#C9C1AD'}
                stroke="#FBF8F0"
                strokeWidth="1.5"
                onMouseEnter={() =>
                  setHovered({
                    kind: 'Supply',
                    price: tier.price,
                    baseVol: tier.cumulative_base,
                    quoteVol: tier.cumulative_base * tier.price,
                    x: cx,
                    y: cy,
                    note:
                      Math.abs(tier.price - chartData.pStar) < 0.01
                        ? 'Pinned Marginal Tier (Pro-Rata)'
                        : isFilled
                          ? 'In-the-Money Seller Tier'
                          : 'Out-of-the-Money (Refunded)',
                  })
                }
              />
            );
          })}

          {/* Interactive demand nodes */}
          {chartData.demandTiers.map((tier, idx) => {
            const cx = chartData.toX(tier.cumulative_base);
            const cy = chartData.toY(tier.price);
            const isFilled = tier.price >= chartData.pStar - 1e-4;
            return (
              <circle
                key={`dnode-${idx}`}
                cx={cx}
                cy={cy}
                r={4.5}
                className="cursor-pointer transition-all"
                fill={isFilled ? '#2C4A8A' : '#C9C1AD'}
                stroke="#FBF8F0"
                strokeWidth="1.5"
                onMouseEnter={() =>
                  setHovered({
                    kind: 'Demand',
                    price: tier.price,
                    baseVol: tier.cumulative_base,
                    quoteVol: tier.cumulative_quote ?? tier.cumulative_base * tier.price,
                    x: cx,
                    y: cy,
                    note:
                      Math.abs(tier.price - chartData.pStar) < 0.01
                        ? 'Pinned Marginal Tier (Pro-Rata)'
                        : isFilled
                          ? 'In-the-Money Buyer Tier'
                          : 'Out-of-the-Money (Refunded)',
                  })
                }
              />
            );
          })}

          {/* Equilibrium p* lock marker */}
          <g
            className="cursor-pointer"
            onMouseEnter={() =>
              setHovered({
                kind: 'Equilibrium',
                price: chartData.pStar,
                baseVol: chartData.eqBase,
                quoteVol: chartData.eqBase * chartData.pStar,
                x: eqX,
                y: eqY,
                note: 'Closed-form Uniform Clearing Equilibrium p*',
              })
            }
          >
            <circle cx={eqX} cy={eqY} r={10} fill="#C6462B" opacity="0.16" />
            <circle
              cx={eqX}
              cy={eqY}
              r={5.5}
              fill="#C6462B"
              stroke="#FBF8F0"
              strokeWidth="2"
            />
          </g>

          {/* Equilibrium price tag — pressed vermilion label */}
          <g transform={`translate(${Math.min(width - 210, Math.max(pad.left + 8, eqX + 10))}, ${Math.max(pad.top + 6, eqY - 30)})`}>
            <rect
              width="192"
              height="25"
              rx="0"
              fill="#C6462B"
              stroke="#852B1A"
              strokeWidth="1"
            />
            <text
              x="96"
              y="16.5"
              textAnchor="middle"
              fill="#FBF8F0"
              className="font-mono text-[11px] font-bold"
            >
              p* = ${formatPrice(chartData.pStar, 2)} {quoteSymbol}
            </text>
          </g>
        </svg>
        </div>

        {/* Interactive tooltip */}
        {hovered && (
          <div className="pointer-events-none absolute right-3 top-3 max-w-[260px] border border-ink border-l-2 border-l-vermilion-500 bg-paper-bright px-3 py-2 shadow-slip">
            <div className="font-display text-[12px] font-bold text-ink">
              {hovered.kind} tier · ${formatPrice(hovered.price, 2)} {quoteSymbol}/{baseSymbol}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-ink-muted tabular-nums">
              Cum. volume: {formatToken(hovered.baseVol, 3)} {baseSymbol} ($
              {formatPrice(hovered.quoteVol, 0)} {quoteSymbol})
            </div>
            <div className="mt-0.5 font-mono text-[9px] text-vermilion-700">
              {hovered.note}
            </div>
          </div>
        )}
      </div>

      {/* Closed-form formula readout */}
      <div className="bg-paper-soft px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-xs text-ink-muted tabular-nums">
            <Info className="h-3.5 w-3.5 shrink-0 self-center text-cobalt-600" aria-hidden="true" />
            <span className="text-xs font-bold uppercase tracking-label text-ink-muted">
              {isLivePreview ? 'Current queue p*' : 'Settled p*'}
            </span>
            <span className="text-ink-soft">
              = (R_y + 2·D_y) / (R_x + 2·S_x) = ({formatPrice(settlement.reserves_before.ry, 0)} + 2×
              {formatPrice(settlement.total_buy_quote_eligible, 0)}) / (
              {formatToken(settlement.reserves_before.rx, 2)} + 2×
              {formatToken(settlement.total_sell_base_eligible, 2)}) =
            </span>
            <span
              data-testid="uniform-clearing-price-readout"
              className="border border-vermilion-600 bg-vermilion-500 px-2 py-0.5 font-bold text-[#FBF8F0]"
            >
              ${formatPrice(settlement.clearing_price, 2)} {quoteSymbol}/{baseSymbol}
            </span>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs text-ink-soft tabular-nums">
            <span className="inline-flex items-center gap-1 border border-cobalt-600/30 bg-cobalt-50 px-2 py-0.5 text-cobalt-700">
              <GitMerge className="h-3.5 w-3.5" />
              <span>
                CoW P2P {formatToken(settlement.cow_matched_base, 2)} {baseSymbol} ·{' '}
                {formatPrice(settlement.cow_ratio_pct, 1)}%
              </span>
            </span>
            <InfoTooltip label="CoW matching" text={PRO_TOOLTIPS.cow} />
          </div>
        </div>
      </div>
    </section>
  );
};
