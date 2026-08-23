import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatCurrency } from '../i18n';
import { niceScale, formatTick, shortPeriodLabel, signPrefix } from '../utils/chartScale';

// Spojnicový graf utraceno-po-obdobích. Vlastní SVG — aplikace záměrně nemá
// žádnou chart knihovnu (viz konvence „vlastní CSS, žádný UI framework").
//
// Pravidla, která tu drží čitelnost a nesmí se rozvolnit:
//  • čáry 2px s kulatými spoji, body r≥4 s 2px prstencem v barvě podkladu
//    (aby zůstaly čitelné tam, kde se křivky kříží),
//  • mřížka hairline, plná, o stupeň od podkladu — nikdy čárkovaná,
//  • jedna osa Y (nikdy dvě škály v jednom grafu),
//  • popisky a hodnoty nosí textové barvy, ne barvu série; identitu nese
//    barevná značka vedle textu,
//  • přímé popisky jen u ≤4 zapnutých sérií a jen když se nepřekrývají,
//  • hodnota je vždy dostupná i bez hoveru (tabulkový pohled na stránce).

const PAD = { top: 16, right: 24, bottom: 34, left: 64 };
const LABEL_PAD_RIGHT = 112;   // místo na přímé popisky u konců křivek
const MAX_DIRECT_LABELS = 4;
const LABEL_MIN_GAP = 14;      // px — pod tím se popisky překrývají

export default function SpendLineChart({ periods, series, colors, onPointClick, height = 320 }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState(null);   // index období pod kurzorem / fokusem

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  useEffect(() => { setActive(null); }, [periods, series]);

  const n = periods.length;
  const plotH = Math.max(10, height - PAD.top - PAD.bottom);

  const all = series.flatMap(s => s.values);
  const { min, max, ticks } = niceScale(Math.min(...all, 0), Math.max(...all, 0));

  const y = v => PAD.top + ((max - v) / (max - min || 1)) * plotH;

  // Přímé popisky konců křivek — jen když se navzájem nepřekrývají. Při
  // sbíhajících se čarách by odsazení popisků odtrhlo od jejich linky a četlo
  // by se to jako šum, proto se v tom případě spolehneme na legendu a tooltip.
  // Vyhodnocuje se PŘED šířkou plochy, aby se místo na popisky nerezervovalo,
  // když se nakonec nevykreslí (y na šířce plochy nezávisí).
  const showLabels = series.length > 0 && series.length <= MAX_DIRECT_LABELS;
  const endLabels = showLabels
    ? series.map(s => ({ id: s.category_id, name: s.name, y: y(s.values[n - 1] ?? 0) }))
        .sort((a, b) => a.y - b.y)
    : [];
  const labelsFit = endLabels.length > 0
    && endLabels.every((l, i) => i === 0 || l.y - endLabels[i - 1].y >= LABEL_MIN_GAP);

  const padRight = labelsFit ? LABEL_PAD_RIGHT : PAD.right;
  const plotW = Math.max(10, width - PAD.left - padRight);
  const x = i => (n <= 1 ? PAD.left + plotW / 2 : PAD.left + (i * plotW) / (n - 1));

  function pointerIndex(evt) {
    const rect = evt.currentTarget.getBoundingClientRect();
    const px = evt.clientX - rect.left;
    if (n <= 1) return 0;
    const step = plotW / (n - 1);
    return Math.max(0, Math.min(n - 1, Math.round((px - PAD.left) / step)));
  }

  function handleKey(e) {
    if (n === 0) return;
    if (e.key === 'ArrowRight') { setActive(i => Math.min(n - 1, (i ?? -1) + 1)); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { setActive(i => Math.max(0, (i ?? n) - 1)); e.preventDefault(); }
    else if (e.key === 'Escape') setActive(null);
  }

  const tooltipRows = active == null ? [] : series
    .map(s => ({ id: s.category_id, name: s.name, value: s.values[active] ?? 0 }))
    .sort((a, b) => b.value - a.value);

  // Tooltip drží uvnitř grafu — u pravého okraje se překlopí doleva.
  const tipLeft = active == null ? 0 : x(active);
  const tipFlip = tipLeft > PAD.left + plotW * 0.6;

  return (
    <div className="chart-wrap" ref={wrapRef}>
      {width > 0 && (
        <svg
          className="chart-svg"
          width={width}
          height={height}
          role="img"
          tabIndex={0}
          aria-label={`Vývoj výdajů po obdobích, ${series.length} zapnutých kategorií. Šipkami vlevo a vpravo projdete jednotlivá období.`}
          onPointerMove={e => setActive(pointerIndex(e))}
          onPointerLeave={() => setActive(null)}
          onKeyDown={handleKey}
          onBlur={() => setActive(null)}
        >
          {/* mřížka + osa Y */}
          {ticks.map(tv => (
            <g key={tv}>
              <line
                x1={PAD.left} x2={PAD.left + plotW} y1={y(tv)} y2={y(tv)}
                className={tv === 0 ? 'chart-axis-line' : 'chart-grid-line'}
              />
              <text x={PAD.left - 10} y={y(tv)} className="chart-tick chart-tick-y">{formatTick(tv)}</text>
            </g>
          ))}

          {/* osa X */}
          {periods.map((p, i) => {
            const everyNth = Math.ceil(n / 12);
            if (i % everyNth !== 0 && i !== n - 1) return null;
            return (
              <text key={p.key} x={x(i)} y={height - 12} className="chart-tick chart-tick-x">
                {shortPeriodLabel(p.key)}
              </text>
            );
          })}

          {/* zaměřovač */}
          {active != null && (
            <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plotH} className="chart-crosshair" />
          )}

          {/* křivky */}
          {series.map(s => {
            const color = colors.get(s.category_id);
            const d = s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join(' ');
            return (
              <g key={s.category_id}>
                <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                {(n <= 18 || active != null) && s.values.map((v, i) => (
                  (n <= 18 || i === active) && (
                    <circle
                      key={i} cx={x(i)} cy={y(v)} r={i === active ? 5 : 4}
                      fill={color} className={`chart-dot${onPointClick ? ' chart-dot-link' : ''}`}
                      onClick={onPointClick ? () => onPointClick(s.category_id, i) : undefined}
                    >
                      <title>{`${s.name}, ${shortPeriodLabel(periods[i].key)}: ${signPrefix(v)}${formatCurrency(v)}`}</title>
                    </circle>
                  )
                ))}
              </g>
            );
          })}

          {/* přímé popisky konců křivek */}
          {labelsFit && endLabels.map(l => (
            <text key={l.id} x={PAD.left + plotW + 10} y={l.y + 4} className="chart-end-label">
              {l.name.length > 16 ? `${l.name.slice(0, 15)}…` : l.name}
            </text>
          ))}
        </svg>
      )}

      {active != null && tooltipRows.length > 0 && (
        <div
          className="chart-tooltip"
          style={{ left: tipLeft, transform: `translate(${tipFlip ? 'calc(-100% - 12px)' : '12px'}, 0)` }}
        >
          <div className="chart-tooltip-period">{shortPeriodLabel(periods[active].key)}</div>
          {tooltipRows.map(r => (
            <div key={r.id} className="chart-tooltip-row">
              <span className="chart-tooltip-key" style={{ background: colors.get(r.id) }} />
              <span className="chart-tooltip-name">{r.name}</span>
              <span className="chart-tooltip-value">{signPrefix(r.value)}{formatCurrency(r.value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
