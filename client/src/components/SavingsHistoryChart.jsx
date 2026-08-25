import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatCurrency } from '../i18n';
import { niceScale, formatTick, shortPeriodLabel, signPrefix } from '../utils/chartScale';

// Dva panely nad sebou se SPOLEČNOU osou X:
//  • horní — zůstatek (dopočtený plnou čarou, skutečný ze snapshotů čárkovaně),
//  • dolní — čisté saldo období jako sloupce kolem nuly.
// Dvě škály v jednom grafu aplikace zakazuje (viz SpendLineChart.jsx) a saldo
// v desítkách tisíc vedle zůstatku ve stovkách tisíc by se stejně nedalo číst.

const PAD = { top: 16, right: 24, bottom: 34, left: 72 };
const LABEL_H = 28;   // vlastní řádek pro popisek panelu ("Zůstatek" / "Saldo za období") nad jeho osou
const LABEL_GAP = 14; // odstup popisku od prvního gridline — při menším se popisek opticky slévá s horním tickem osy
const BALANCE_H = 200;
const NET_H = 140;
const GAP = 40;   // mezera mezi panely — musí pojmout popisek dolního panelu a opticky oddělit obě osy
// Strop na šířku pásma jednoho období. Bez něj se pár období roztáhne přes celou
// stránku a ze sloupců zbydou proužky v prázdné ploše; nad ~12 obdobími se strop
// neuplatní a graf vyplní šířku jako dřív.
const MAX_BAND_W = 110;

const COLOR_DERIVED = '#6366f1';
const COLOR_ACTUAL = '#0ea5e9';
const COLOR_POSITIVE = '#16a34a';
const COLOR_NEGATIVE = '#dc2626';

export default function SavingsHistoryChart({ periods, values, onPeriodClick, clickablePeriods, showDerived = true, showActual = true }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  useEffect(() => { setActive(null); }, [periods, values]);

  const n = periods.length;
  const availW = Math.max(10, width - PAD.left - PAD.right);
  // Pásmo = vodorovný díl jednoho období. Když by při malém počtu období vyšlo
  // širší než strop, plocha grafu se zúží (a osa X skončí dřív) místo toho, aby
  // se pár sloupců rozprostřelo přes celou stránku.
  const plotW = n > 0 ? Math.min(availW, n * MAX_BAND_W) : availW;
  // Každý panel má nad svou osou vlastní řádek na popisek (LABEL_H), aby bylo
  // z grafu samotného poznat, který panel je zůstatek a který saldo — ne jen
  // z legendy vedle grafu, ta mluví jen o křivkách zůstatku.
  const balanceTop = LABEL_H + PAD.top;
  const balanceH = BALANCE_H - PAD.top;
  const netTop = balanceTop + balanceH + GAP + LABEL_H;
  const netH = NET_H - PAD.bottom;
  const height = netTop + NET_H;
  // Popisek sedí LABEL_GAP nad prvním gridline svého panelu — konzistentní odstup
  // pro oba panely, ať jsou jejich PAD/GAP hodnoty jakékoli.
  const balanceLabelY = balanceTop - LABEL_GAP;
  const netLabelY = netTop - LABEL_GAP;

  // Osa X sdílená oběma panely — střed sloupce i bod křivky leží na stejném x.
  // Body leží ve STŘEDU svého pásma, ne na krajích plochy: jinak by první a
  // poslední sloupec půlkou přetékal přes osu Y, resp. přes pravý okraj.
  const bandW = n > 0 ? plotW / n : 0;
  // Když strop pásma plochu zúžil, vycentrujeme ji — plocha přilepená doleva
  // s prázdnem vpravo vypadá jako nedokreslený graf, ne jako záměr.
  const plotLeft = PAD.left + (availW - plotW) / 2;
  const x = i => plotLeft + bandW * (i + 0.5);
  const barW = Math.max(10, Math.min(56, bandW * 0.5));

  const balanceValues = values.flatMap(v => [
    showDerived ? v.balance_derived : null,
    showActual ? v.balance_actual : null,
  ]).filter(v => v != null);
  const hasBalance = balanceValues.length > 0;
  // Nezávisle na přepínačích showDerived/showActual — jinak by vypnutí obou
  // sérií lhalo o datech ("zůstatek zatím neznáme"), i když existují, jen jsou
  // schované.
  const hasAnyBalanceData = values.some(v => v.balance_derived != null || v.balance_actual != null);
  // Osa zůstatku se přizpůsobí rozsahu dat (`anchorZero: false`). Zůstatek se
  // pohybuje kolem stovek tisíc a jeho kolísání by u osy od nuly zabralo pár
  // procent výšky panelu — přitom právě ta změna je to, co má horní panel
  // ukazovat. Sloupce salda v dolním panelu zůstávají kotvené na nule.
  // Prázdné pole se sem nesmí dostat (Math.min(...[]) je Infinity), proto fallback.
  const balScale = hasBalance
    ? niceScale(Math.min(...balanceValues), Math.max(...balanceValues), 5, { anchorZero: false })
    : niceScale(0, 0);
  const netScale = niceScale(
    Math.min(0, ...values.map(v => v.net)),
    Math.max(0, ...values.map(v => v.net))
  );

  const yBal = v => balanceTop + balanceH - ((v - balScale.min) / (balScale.max - balScale.min || 1)) * balanceH;
  const yNet = v => netTop + netH - ((v - netScale.min) / (netScale.max - netScale.min || 1)) * netH;
  const zeroY = yNet(0);

  // Křivka se kreslí jen mezi SOUSEDNÍMI body, které oba existují — chybějící
  // snapshot nesmí nic domýšlet, linka se v tom místě přeruší.
  function segments(key) {
    const out = [];
    let run = [];
    values.forEach((v, i) => {
      const val = v[key];
      if (val == null) { if (run.length > 1) out.push(run); run = []; return; }
      run.push(`${x(i)},${yBal(val)}`);
    });
    if (run.length > 1) out.push(run);
    return out.map(pts => pts.join(' '));
  }

  // Klávesová obsluha zrcadlí SpendLineChart.jsx: šipky posouvají aktivní
  // období, Escape ho ruší, Enter/Mezerník na aktivním období vyvolá stejnou
  // akci jako klik na sloupec — jinak by se k `onPeriodClick` uživatel bez
  // myši vůbec nedostal.
  function handleKey(e) {
    if (n === 0) return;
    if (e.key === 'ArrowRight') { setActive(i => Math.min(n - 1, (i ?? -1) + 1)); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { setActive(i => Math.max(0, (i ?? n) - 1)); e.preventDefault(); }
    else if (e.key === 'Escape') setActive(null);
    else if ((e.key === 'Enter' || e.key === ' ') && active != null && onPeriodClick && isClickable(active)) {
      onPeriodClick(active);
      e.preventDefault();
    }
  }

  // Klikatelnost je věc rodiče (zná tx_ids), tady jen čteme boolean per index.
  // Bez `clickablePeriods` se chová jako dřív — klikatelné je vše, co má handler.
  function isClickable(i) {
    return !clickablePeriods || clickablePeriods[i];
  }

  if (!width || !n) return <div className="chart-wrap" ref={wrapRef} style={{ height }} />;

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <svg
        className="chart-svg"
        width={width}
        height={height}
        role="img"
        tabIndex={0}
        aria-label={`Vývoj spoření, ${n} období. Šipkami vlevo a vpravo projdete jednotlivá období.`}
        onKeyDown={handleKey}
        onBlur={() => setActive(null)}
      >
        {/* horní panel — zůstatek */}
        <text x={plotLeft} y={balanceLabelY} className="chart-tick">Zůstatek</text>
        {hasBalance && balScale.ticks.map(tv => (
          <g key={`b${tv}`}>
            <line x1={plotLeft} x2={plotLeft + plotW} y1={yBal(tv)} y2={yBal(tv)} className="chart-grid-line" />
            <text x={plotLeft - 10} y={yBal(tv)} className="chart-tick chart-tick-y">{formatTick(tv)}</text>
          </g>
        ))}
        {!hasAnyBalanceData && (
          <text x={plotLeft} y={balanceTop + balanceH / 2} className="chart-tick">
            Zůstatek zatím neznáme — doplní se z notifikací ze spořicího účtu.
          </text>
        )}
        {showDerived && segments('balance_derived').map((d, i) => (
          <polyline key={`d${i}`} points={d} fill="none" stroke={COLOR_DERIVED} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {showActual && segments('balance_actual').map((d, i) => (
          <polyline key={`a${i}`} points={d} fill="none" stroke={COLOR_ACTUAL} strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {/* Osamocený bod (n===1, nebo hodnota bez souseda na obou stranách)
            nemá s čím spojit čáru — polyline vzniká až od dvou bodů v řadě.
            Bez vlastní vrstvy bodů by taková hodnota zmizela úplně, přestože
            existuje. */}
        {showDerived && values.map((v, i) => v.balance_derived == null ? null : (
          <circle key={`dp${i}`} cx={x(i)} cy={yBal(v.balance_derived)} r="4" fill={COLOR_DERIVED} className="chart-dot" />
        ))}
        {showActual && values.map((v, i) => v.balance_actual == null ? null : (
          <circle key={`ap${i}`} cx={x(i)} cy={yBal(v.balance_actual)} r="4" fill={COLOR_ACTUAL} className="chart-dot" />
        ))}

        {/* dolní panel — saldo */}
        <text x={plotLeft} y={netLabelY} className="chart-tick">Saldo za období</text>
        {netScale.ticks.map(tv => (
          <g key={`n${tv}`}>
            <line x1={plotLeft} x2={plotLeft + plotW} y1={yNet(tv)} y2={yNet(tv)} className="chart-grid-line" />
            <text x={plotLeft - 10} y={yNet(tv)} className="chart-tick chart-tick-y">{formatTick(tv)}</text>
          </g>
        ))}
        <line x1={plotLeft} x2={plotLeft + plotW} y1={zeroY} y2={zeroY} className="chart-axis-line" />
        {values.map((v, i) => {
          const top = v.net >= 0 ? yNet(v.net) : zeroY;
          const h = Math.abs(yNet(v.net) - zeroY);
          return (
            <rect
              key={`bar${i}`}
              x={x(i) - barW / 2}
              y={top}
              width={barW}
              height={Math.max(1, h)}
              fill={v.net >= 0 ? COLOR_POSITIVE : COLOR_NEGATIVE}
              opacity={periods[i]?.partial ? 0.45 : (active == null || active === i ? 1 : 0.55)}
            />
          );
        })}

        {/* společná osa X + interakce */}
        {periods.map((p, i) => (
          <text key={`x${i}`} x={x(i)} y={height - 10} className="chart-tick chart-tick-x">
            {shortPeriodLabel(p.key)}
          </text>
        ))}
        {periods.map((p, i) => (
          <rect
            key={`hit${i}`}
            x={x(i) - bandW / 2}
            y={0}
            width={bandW}
            height={height}
            fill="transparent"
            style={{ cursor: onPeriodClick && isClickable(i) ? 'pointer' : 'default' }}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            onClick={() => onPeriodClick && isClickable(i) && onPeriodClick(i)}
          >
            <title>
              {/* formatCurrency bere záměrně absolutní hodnotu (viz i18n.js) —
                  saldo může být záporné (výběry převýšily vklady), proto
                  znaménko nese signPrefix zvlášť. Vklady/výběry jsou vždy
                  nezáporné dílčí součty, tam se signPrefix netýká. */}
              {`${shortPeriodLabel(p.key)}${p.partial ? ' (probíhá)' : ''}\n`}
              {`Saldo: ${signPrefix(values[i].net)}${formatCurrency(values[i].net)}\n`}
              {`Vklady: ${formatCurrency(values[i].deposits)} · Výběry: ${formatCurrency(values[i].withdrawals)}`}
            </title>
          </rect>
        ))}
        {active != null && (
          <line
            x1={x(active)} x2={x(active)}
            y1={balanceTop} y2={netTop + netH}
            className="chart-grid-line"
          />
        )}
      </svg>
    </div>
  );
}
