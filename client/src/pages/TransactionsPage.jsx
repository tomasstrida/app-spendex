import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Pencil, Trash2, Check, X, Columns3, Search } from 'lucide-react';
import Layout from '../components/Layout';
import { formatCurrency, formatPeriod, addPeriods, t } from '../i18n';
import { usePeriod } from '../contexts/PeriodContext';
import { usePeriodKeys } from '../hooks/usePeriodKeys';
import { buildAccountNameMap, accountNameFor } from '../utils/accountName';
import { accountFlow } from '../utils/accountFlow';

const ALL_COLS = [
  { key: 'date',                 label: 'Datum',           default: true,  always: true },
  { key: 'tx_time',              label: 'Čas',             default: false },
  { key: 'description',          label: 'Popis',           default: true,  always: true },
  { key: 'tx_type',              label: 'Typ úhrady',      default: false },
  { key: 'category_name',        label: 'Kategorie',       default: true },
  { key: 'subcategory_name',     label: 'Subkategorie',    default: false },
  { key: 'ab_category',          label: 'AirBank kat.',    default: true },
  { key: 'entered_by',           label: 'Kdo zadal',       default: false },
  { key: 'counterparty_account', label: 'Číslo účtu',      default: false },
  { key: 'flow_source',          label: 'Zdroj',           default: false },
  { key: 'flow_target',          label: 'Cíl',             default: false },
  { key: 'place',                label: 'Obchodní místo',  default: false },
  { key: 'note',                 label: 'Zpráva/Poznámka', default: true },
  { key: 'amount',               label: 'Částka',          default: true,  always: true },
];

const LS_KEY = 'spendex_tx_cols_v2';
const PAGE_SIZE = 400;

function loadCols() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY));
    if (saved) {
      // Jednorázová migrace: přidat sloupec note stávajícím uživatelům (před 'amount'),
      // aniž bychom resetovali jejich ostatní volby sloupců.
      if (!localStorage.getItem('spendex_tx_note_migrated')) {
        localStorage.setItem('spendex_tx_note_migrated', '1');
        if (!saved.includes('note')) {
          const idx = saved.indexOf('amount');
          if (idx >= 0) saved.splice(idx, 0, 'note'); else saved.push('note');
          localStorage.setItem(LS_KEY, JSON.stringify(saved));
        }
      }
      return saved;
    }
  } catch { /* ignore */ }
  return ALL_COLS.filter(c => c.default).map(c => c.key);
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' });
}

export default function TransactionsPage() {
  const [searchParams] = useSearchParams();
  const urlFrom = searchParams.get('from');
  const urlTo = searchParams.get('to');
  const urlPeriod = searchParams.get('period');
  const highlightId = searchParams.get('highlight');
  const { period, setPeriod, currentPeriod, resetToCurrent } = usePeriod();
  const [periodStart, setPeriodStart] = useState(null);
  const [periodEnd, setPeriodEnd] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const accountNameMap = useMemo(() => buildAccountNameMap(accounts), [accounts]);
  const accountById = useMemo(() => new Map((accounts || []).map(a => [a.id, a.name])), [accounts]);
  const [filterCats, setFilterCats] = useState(() => {
    // Akceptujeme oboje: category_ids=1,2,none (multi) i category_id=1 (single).
    const multi = searchParams.get('category_ids');
    if (multi) return new Set(multi.split(',').map(s => s.trim()).filter(Boolean));
    const single = searchParams.get('category_id');
    return new Set(single ? [single] : []);
  });
  const [amountMin, setAmountMin] = useState(searchParams.get('amount_min') || '');
  const [amountMax, setAmountMax] = useState(searchParams.get('amount_max') || '');
  const [appliedAmountMin, setAppliedAmountMin] = useState(amountMin);
  const [appliedAmountMax, setAppliedAmountMax] = useState(amountMax);
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [appliedSearch, setAppliedSearch] = useState(search);
  const [counterparty, setCounterparty] = useState(searchParams.get('counterparty') || '');
  const [direction, setDirection] = useState(searchParams.get('direction') || '');
  const [matchPatterns, setMatchPatterns] = useState(searchParams.get('match_patterns') || '');
  const [spendingOnly, setSpendingOnly] = useState(searchParams.get('spending_only') === '1');
  const [loading, setLoading] = useState(true);
  const [customMode, setCustomMode] = useState(!!(urlFrom && urlTo));
  usePeriodKeys({ enabled: !customMode });
  const [customFrom, setCustomFrom] = useState(urlFrom || '');
  const [customTo, setCustomTo] = useState(urlTo || '');
  const [editId, setEditId] = useState(null);
  const [editData, setEditData] = useState({});
  const [editSubcats, setEditSubcats] = useState([]);
  const [addingSubcat, setAddingSubcat] = useState(false);
  const [newSubcatName, setNewSubcatName] = useState('');
  const [catEditId, setCatEditId] = useState(null);
  const [filterSubcatId, setFilterSubcatId] = useState(searchParams.get('subcategory_id') || '');
  const [filterSubcatOptions, setFilterSubcatOptions] = useState([]);
  const [visibleCols, setVisibleCols] = useState(loadCols);
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const pickerRef = useRef();
  // Ref pro hlídání, zda jsme již zvýraznění provedli (jednorázové po načtení)
  const highlightedRef = useRef(false);

  useEffect(() => {
    // URL deep-link má přednost před contextem
    if (urlPeriod) setPeriod(urlPeriod);

    Promise.all([
      fetch('/api/settings').then(r => r.json()),
      fetch('/api/categories').then(r => r.json()),
      fetch('/api/accounts').then(r => r.json()),
    ]).then(([s, cats, accs]) => {
      setPeriodStart(s.period_start);
      setPeriodEnd(s.period_end);
      if (!urlFrom) setCustomFrom(s.period_start);
      if (!urlTo) setCustomTo(s.period_end);
      setCategories(cats);
      setAccounts(Array.isArray(accs) ? accs : []);
    });
  }, []);

  // Debounce textových amount inputů, ať se request neposílá při každém stisku
  useEffect(() => {
    const id = setTimeout(() => {
      setAppliedAmountMin(amountMin);
      setAppliedAmountMax(amountMax);
      setAppliedSearch(search);
    }, 300);
    return () => clearTimeout(id);
  }, [amountMin, amountMax, search]);

  const buildFilterParams = useCallback((params) => {
    if (filterCats.size > 0) params.set('category_ids', [...filterCats].join(','));
    if (filterSubcatId !== '') params.set('subcategory_id', filterSubcatId);
    if (appliedAmountMin !== '') params.set('amount_min', appliedAmountMin);
    if (appliedAmountMax !== '') params.set('amount_max', appliedAmountMax);
    if (appliedSearch.trim() !== '') params.set('q', appliedSearch.trim());
    if (counterparty.trim() !== '') params.set('counterparty', counterparty.trim());
    if (direction === 'in' || direction === 'out') params.set('direction', direction);
    if (matchPatterns.trim() !== '') params.set('match_patterns', matchPatterns.trim());
    if (spendingOnly) params.set('spending_only', '1');
    params.set('limit', String(PAGE_SIZE));
    return params;
  }, [filterCats, filterSubcatId, appliedAmountMin, appliedAmountMax, appliedSearch, counterparty, direction, matchPatterns, spendingOnly]);

  // Filtr podle subkategorie dává smysl jen když je ve filtru vybraná právě
  // jedna konkrétní kategorie (ne „bez kategorie", ne víc kategorií najednou).
  // Options se dotáhnou pro tuto kategorii; při změně výběru kategorie se
  // dřívější filterSubcatId zahodí (jinak by mohl zůstat neplatný subcat_id
  // z jiné kategorie a filtr by tiše nevracel nic).
  const singleFilterCategoryId = filterCats.size === 1 && [...filterCats][0] !== 'none' ? [...filterCats][0] : null;
  useEffect(() => {
    if (!singleFilterCategoryId) { setFilterSubcatOptions([]); setFilterSubcatId(''); return; }
    let cancelled = false;
    fetch(`/api/subcategories?category_id=${singleFilterCategoryId}`)
      .then(r => (r.ok ? r.json() : []))
      .then(list => {
        if (cancelled) return;
        const opts = Array.isArray(list) ? list : [];
        setFilterSubcatOptions(opts);
        // Zachovej dřívější výběr (vč. deep-linku z URL), jen když stále patří
        // do nabídky aktuální kategorie — jinak by filtr tiše nevracel nic.
        setFilterSubcatId(prev => (prev && opts.some(s => String(s.id) === prev)) ? prev : '');
      })
      .catch(() => { if (!cancelled) { setFilterSubcatOptions([]); setFilterSubcatId(''); } });
    return () => { cancelled = true; };
  }, [singleFilterCategoryId]);

  const loadTransactions = useCallback(() => {
    // Custom range (z URL nebo z UI přepínače) má přednost — fulltext + from/to se vždy kombinují
    if (customMode && customFrom && customTo) {
      setLoading(true);
      const params = buildFilterParams(new URLSearchParams({ from: customFrom, to: customTo }));
      fetch(`/api/transactions?${params}`)
        .then(r => r.json())
        .then(data => {
          setTransactions(data);
          setSelected(new Set());
          setHasMore(data.length === PAGE_SIZE);
        })
        .finally(() => setLoading(false));
      return;
    }
    if (!period) return;
    setLoading(true);
    fetch(`/api/settings?period=${period}`)
      .then(r => r.json())
      .then(s => {
        setPeriodStart(s.period_start);
        setPeriodEnd(s.period_end);
        const params = buildFilterParams(new URLSearchParams({ from: s.period_start, to: s.period_end }));
        return fetch(`/api/transactions?${params}`).then(r => r.json());
      })
      .then(data => {
        setTransactions(data);
        setSelected(new Set());
        setHasMore(data.length === PAGE_SIZE);
      })
      .finally(() => setLoading(false));
  }, [period, customMode, customFrom, customTo, buildFilterParams]);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const offset = transactions.length;
    const baseParams = customMode && customFrom && customTo
      ? { from: customFrom, to: customTo }
      : (periodStart && periodEnd ? { from: periodStart, to: periodEnd } : {});
    const params = buildFilterParams(new URLSearchParams(baseParams));
    params.set('offset', String(offset));
    fetch(`/api/transactions?${params}`)
      .then(r => r.json())
      .then(data => {
        setTransactions(prev => [...prev, ...data]);
        setHasMore(data.length === PAGE_SIZE);
      })
      .finally(() => setLoadingMore(false));
  }, [loadingMore, hasMore, transactions.length, customMode, customFrom, customTo, periodStart, periodEnd, buildFilterParams]);

  useEffect(() => { loadTransactions(); }, [loadTransactions]);

  // Po načtení transakcí scroll na zvýrazněný řádek (z push notifikace ?highlight=<id>)
  useEffect(() => {
    if (!highlightId || highlightedRef.current || transactions.length === 0) return;
    const el = document.querySelector(`[data-tx-id="${highlightId}"]`);
    if (!el) return;
    highlightedRef.current = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('deep-focus');
    const t = setTimeout(() => el.classList.remove('deep-focus'), 2600);
    return () => { clearTimeout(t); el.classList.remove('deep-focus'); };
  }, [transactions, highlightId]);

  // Zavři picker kliknutím ven
  useEffect(() => {
    function onClick(e) {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setColPickerOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function toggleCol(key) {
    setVisibleCols(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      localStorage.setItem(LS_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function handleDelete(id) {
    if (!confirm('Smazat tuto transakci?')) return;
    const r = await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
    if (r.ok) {
      setTransactions(prev => prev.filter(t => t.id !== id));
      setSelected(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  }

  async function handleDeleteSelected() {
    if (!confirm(`Smazat ${selected.size} označených transakcí?`)) return;
    setDeleting(true);
    const ids = [...selected];
    const r = await fetch('/api/transactions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (r.ok) {
      setTransactions(prev => prev.filter(t => !selected.has(t.id)));
      setSelected(new Set());
    }
    setDeleting(false);
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  }

  function toggleCatChip(value) {
    setFilterCats(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function clearAllFilters() {
    setFilterCats(new Set());
    setFilterSubcatId('');
    setAmountMin('');
    setAmountMax('');
    setSearch('');
    setCounterparty('');
    setDirection('');
    setMatchPatterns('');
    setSpendingOnly(false);
  }

  function toggleSelectAll() {
    if (selected.size === transactions.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(transactions.map(t => t.id)));
    }
  }

  async function saveCatQuick(tx, categoryId) {
    // Quick-edit mění JEN kategorii — subcategory_id proto vždy resetujeme na null.
    // Kritické: pokud by se poslalo jen category_id a tx měla subcategory_id staré
    // kategorie, backend by validaci vlastnictví subkategorie proti NOVÉ kategorii
    // vyhodnotil jako neplatnou a vrátil by 400 na celý PATCH (viz Task 5 review).
    const body = { category_id: categoryId ? parseInt(categoryId) : null, subcategory_id: null };
    const r = await fetch(`/api/transactions/${tx.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      const updated = await r.json();
      const cat = categories.find(c => c.id === updated.category_id);
      setTransactions(prev => prev.map(t =>
        t.id === updated.id ? { ...updated, category_name: cat?.name, category_color: cat?.color, subcategory_name: null } : t
      ));
    }
    setCatEditId(null);
  }

  function startEdit(tx) {
    setCatEditId(null);
    setEditId(tx.id);
    setAddingSubcat(false);
    setNewSubcatName('');
    setEditData({
      // u e-mailových kartových plateb je obchodník jen v `place` → předvyplň ho do Popisu,
      // ať ho uživatel při ručním zařazování vidí (a uložením se propíše do description)
      description: tx.description || tx.place || '',
      category_id: tx.category_id ? String(tx.category_id) : '',
      subcategory_id: tx.subcategory_id ? String(tx.subcategory_id) : '',
      amount: String(Math.abs(tx.amount)),
      date: tx.date,
      note: tx.note || '',
    });
  }

  // Subkategorie pro edit řádek závisí na aktuálně vybrané kategorii v editData.
  // Tento efekt jen NAČÍTÁ options pro dropdown. Reset subcategory_id při ruční
  // změně kategorie řeší synchronně onChange u selectu Kategorie (níže) —
  // stejný vzor jako RulesPage — jinak by mezi změnou kategorie a doběhnutím
  // fetch šlo uložit neplatnou (cizí) subcategory_id.
  useEffect(() => {
    const catId = editData.category_id;
    if (!editId || !catId) { setEditSubcats([]); return; }
    let cancelled = false;
    fetch(`/api/subcategories?category_id=${catId}`)
      .then(r => (r.ok ? r.json() : []))
      .then(list => { if (!cancelled) setEditSubcats(Array.isArray(list) ? list : []); })
      .catch(() => { if (!cancelled) setEditSubcats([]); });
    return () => { cancelled = true; };
  }, [editId, editData.category_id]);

  // Založí novou subkategorii pod aktuálně vybranou kategorií přímo z editace
  // transakce (bez odskoku na stránku Kategorie) a rovnou ji transakci přiřadí.
  async function createSubcategory() {
    const name = newSubcatName.trim();
    const catId = editData.category_id;
    if (!name || !catId) return;
    const res = await fetch('/api/subcategories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category_id: parseInt(catId), name }),
    });
    if (res.ok) {
      const created = await res.json();
      setEditSubcats(prev => [...prev, created].sort(
        (a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name, 'cs')
      ));
      setEditData(d => ({ ...d, subcategory_id: String(created.id) }));
      setNewSubcatName('');
      setAddingSubcat(false);
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Nepodařilo se přidat subkategorii.');
    }
  }

  async function saveEdit(tx) {
    const body = {
      description: editData.description,
      category_id: editData.category_id ? parseInt(editData.category_id) : null,
      subcategory_id: editData.subcategory_id ? parseInt(editData.subcategory_id) : null,
      amount: tx.amount < 0 ? -Math.abs(parseFloat(editData.amount)) : Math.abs(parseFloat(editData.amount)),
      date: editData.date,
      note: editData.note,
    };
    const r = await fetch(`/api/transactions/${tx.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      const updated = await r.json();
      const cat = categories.find(c => c.id === updated.category_id);
      // PATCH response je syrový řádek (bez JOINu na subcategories) — subcategory_name
      // dopočítáme z právě načtených options pro editovanou kategorii.
      const subcat = editSubcats.find(s => s.id === updated.subcategory_id);
      setTransactions(prev => prev.map(t =>
        t.id === updated.id
          ? { ...updated, category_name: cat?.name, category_color: cat?.color, subcategory_name: subcat?.name ?? null }
          : t
      ));
      setEditId(null);
    }
  }

  const total = transactions.reduce((s, t) => s + t.amount, 0);
  const cols = ALL_COLS.filter(c => visibleCols.includes(c.key));
  const allSelected = transactions.length > 0 && selected.size === transactions.length;
  const someSelected = selected.size > 0 && !allSelected;

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Transakce</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {!customMode && period && (
            <div className="month-nav">
              <button className="btn btn-ghost btn-icon" onClick={() => setPeriod(p => addPeriods(p, -1))}>
                <ChevronLeft size={18} />
              </button>
              <span className="month-label">{formatPeriod(periodStart, periodEnd)}</span>
              <button
                className="btn btn-ghost btn-icon"
                onClick={() => setPeriod(p => addPeriods(p, 1))}
                disabled={period >= currentPeriod}
              >
                <ChevronRight size={18} />
              </button>
              <button
                className="btn btn-ghost"
                onClick={resetToCurrent}
                disabled={period === currentPeriod}
                title={t.period.resetToCurrent}
              >
                {t.period.resetToCurrent}
              </button>
            </div>
          )}
          {customMode && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                className="input"
                type="date"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                style={{ maxWidth: 140 }}
              />
              <span className="text-muted" style={{ fontSize: 13 }}>–</span>
              <input
                className="input"
                type="date"
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                style={{ maxWidth: 140 }}
              />
            </div>
          )}
          <button
            className={`btn btn-ghost`}
            style={{ fontSize: 12, padding: '5px 10px' }}
            onClick={() => {
              setCustomMode(m => !m);
              setSelected(new Set());
            }}
            title={customMode ? 'Přepnout na billing období' : 'Vlastní rozsah dat'}
          >
            {customMode ? 'Billing období' : 'Vlastní rozsah'}
          </button>
          {/* Přepínač sloupců */}
          <div className="col-picker-wrap" ref={pickerRef}>
            <button
              className={`btn btn-ghost${colPickerOpen ? ' active' : ''}`}
              onClick={() => setColPickerOpen(o => !o)}
              title="Zobrazené sloupce"
            >
              <Columns3 size={16} /> Sloupce
            </button>
            {colPickerOpen && (
              <div className="col-picker-dropdown">
                {ALL_COLS.map(c => (
                  <label key={c.key} className={`col-picker-item${c.always ? ' disabled' : ''}`}>
                    <input
                      type="checkbox"
                      checked={visibleCols.includes(c.key)}
                      disabled={c.always}
                      onChange={() => !c.always && toggleCol(c.key)}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="tx-filters">
        {(counterparty || direction === 'in' || direction === 'out' || matchPatterns || spendingOnly) && (
          <div style={{ marginBottom: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {counterparty && (
              <span className="tx-chip tx-chip-active" style={{ cursor: 'default' }}>
                Protistrana: {counterparty}
                <button
                  type="button"
                  onClick={() => setCounterparty('')}
                  style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, marginLeft: 6, display: 'inline-flex', alignItems: 'center' }}
                  title="Zrušit filtr protistrany"
                >
                  <X size={12} />
                </button>
              </span>
            )}
            {(direction === 'in' || direction === 'out') && (
              <span className="tx-chip tx-chip-active" style={{ cursor: 'default' }}>
                {direction === 'in' ? 'Jen příchozí' : 'Jen odchozí'}
                <button
                  type="button"
                  onClick={() => setDirection('')}
                  style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, marginLeft: 6, display: 'inline-flex', alignItems: 'center' }}
                  title="Zrušit filtr směru"
                >
                  <X size={12} />
                </button>
              </span>
            )}
            {matchPatterns && (
              <span className="tx-chip tx-chip-active" style={{ cursor: 'default' }}>
                Patterny: {matchPatterns}
                <button
                  type="button"
                  onClick={() => setMatchPatterns('')}
                  style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, marginLeft: 6, display: 'inline-flex', alignItems: 'center' }}
                  title="Zrušit filtr patternů"
                >
                  <X size={12} />
                </button>
              </span>
            )}
            {spendingOnly && (
              <span className="tx-chip tx-chip-active" style={{ cursor: 'default' }}>
                Jen výdajové účty
                <button
                  type="button"
                  onClick={() => setSpendingOnly(false)}
                  style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, marginLeft: 6, display: 'inline-flex', alignItems: 'center' }}
                  title="Zrušit omezení na výdajové účty"
                >
                  <X size={12} />
                </button>
              </span>
            )}
          </div>
        )}
        <div style={{ position: 'relative', marginBottom: 4 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text2)', pointerEvents: 'none' }} />
          <input
            className="input"
            type="search"
            placeholder="Hledat (popis, poznámka, místo, protiúčet, kategorie…)"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', maxWidth: 420, paddingLeft: 32 }}
          />
        </div>
        <div className="tx-chip-groups">
          <div className="tx-chip-row">
            <button
              type="button"
              className={`tx-chip tx-chip-none${filterCats.has('none') ? ' tx-chip-active' : ''}`}
              onClick={() => toggleCatChip('none')}
              title="Transakce bez kategorie"
            >
              Bez kategorie
            </button>
          </div>
          {[
            { type: 1, label: 'Měsíční' },
            { type: 2, label: 'Roční' },
            { type: 3, label: 'Fondy' },
          ].map(group => {
            const items = categories.filter(c => c.type === group.type);
            if (items.length === 0) return null;
            return (
              <div key={group.type} className="tx-chip-row">
                <span className="tx-chip-group-label">{group.label}</span>
                {items.map(c => {
                  const active = filterCats.has(String(c.id));
                  const color = c.color || '#6366f1';
                  return (
                    <button
                      type="button"
                      key={c.id}
                      className={`tx-chip${active ? ' tx-chip-active' : ''}`}
                      onClick={() => toggleCatChip(String(c.id))}
                      style={active ? {
                        background: color + '33',
                        color: color,
                        borderColor: color + '66',
                      } : { '--chip-dot': color }}
                    >
                      <span className="tx-chip-dot" style={{ background: color }} />
                      {c.name}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        {singleFilterCategoryId && filterSubcatOptions.length > 0 && (
          <div className="tx-chip-groups">
            <div className="tx-chip-row">
              <span className="tx-chip-group-label">Subkategorie</span>
              {filterSubcatOptions.map(s => {
                const active = filterSubcatId === String(s.id);
                return (
                  <button
                    type="button"
                    key={s.id}
                    className={`tx-chip${active ? ' tx-chip-active' : ''}`}
                    onClick={() => setFilterSubcatId(active ? '' : String(s.id))}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="tx-amount-filter">
          <span className="tx-filter-label">Částka:</span>
          <input
            className="input tx-amount-input"
            type="number"
            min="0"
            step="1"
            placeholder="od"
            value={amountMin}
            onChange={e => setAmountMin(e.target.value)}
          />
          <span className="text-muted" style={{ fontSize: 13 }}>–</span>
          <input
            className="input tx-amount-input"
            type="number"
            min="0"
            step="1"
            placeholder="do"
            value={amountMax}
            onChange={e => setAmountMax(e.target.value)}
          />
          <span className="text-muted" style={{ fontSize: 12 }}>Kč</span>
          {(filterCats.size > 0 || filterSubcatId !== '' || amountMin !== '' || amountMax !== '' || search !== '' || counterparty !== '' || direction !== '' || matchPatterns !== '' || spendingOnly) && (
            <button
              type="button"
              className="btn btn-ghost tx-filter-clear"
              onClick={clearAllFilters}
              title="Zrušit všechny filtry"
            >
              <X size={14} /> Vymazat filtry
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="page-loading">Načítání…</div>
      ) : transactions.length === 0 ? (
        <div className="empty-state">
          <p>{appliedSearch.trim() !== '' ? 'Nic nenalezeno.' : 'Žádné transakce pro toto období.'}</p>
        </div>
      ) : (
        <>
          <div className="tx-summary">
            <span className="text-muted" style={{ fontSize: 13 }}>{transactions.length} transakcí</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              Celkem:{' '}
              <span className={total > 0 ? 'tx-amount-in' : total < 0 ? 'tx-amount-out' : ''}>
                {total > 0 ? '+' : total < 0 ? '−' : ''}{formatCurrency(Math.abs(total))}
              </span>
            </span>
          </div>

          {selected.size > 0 && (
            <div className="tx-bulk-bar">
              <span className="text-muted" style={{ fontSize: 13 }}>Označeno: <strong style={{ color: 'var(--text)' }}>{selected.size}</strong></span>
              <button
                className="btn btn-danger"
                onClick={handleDeleteSelected}
                disabled={deleting}
              >
                <Trash2 size={15} />
                {deleting ? 'Mažu…' : `Smazat ${selected.size}`}
              </button>
            </div>
          )}

          <div className="tx-table">
            {/* Hlavička */}
            <div className="tx-header-row" style={{ gridTemplateColumns: colsToGrid(cols) }}>
              <span className="tx-th">
                <input
                  type="checkbox"
                  className="tx-checkbox"
                  checked={allSelected}
                  ref={el => { if (el) el.indeterminate = someSelected; }}
                  onChange={toggleSelectAll}
                />
              </span>
              {cols.map(c => (
                <span key={c.key} className={`tx-th${c.key === 'amount' ? ' tx-th-right' : ''}`}>{c.label}</span>
              ))}
              <span className="tx-th" />
            </div>

            {transactions.map(tx => editId === tx.id ? (
              <div key={tx.id} className="tx-edit-row">
                <div className="tx-edit-grid">
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: 11 }}>Datum</label>
                    <input
                      className="input"
                      type="date"
                      value={editData.date}
                      onChange={e => setEditData(d => ({ ...d, date: e.target.value }))}
                      style={{ maxWidth: 140 }}
                    />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: 11 }}>Popis</label>
                    <input
                      className="input"
                      value={editData.description}
                      onChange={e => setEditData(d => ({ ...d, description: e.target.value }))}
                    />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: 11 }}>Kategorie</label>
                    <select
                      className="input"
                      value={editData.category_id}
                      onChange={e => { setAddingSubcat(false); setNewSubcatName(''); setEditData(d => ({ ...d, category_id: e.target.value, subcategory_id: '' })); }}
                    >
                      <option value="">— bez kategorie —</option>
                      {categories.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: 11 }}>Subkategorie</label>
                    {addingSubcat ? (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <input
                          className="input"
                          autoFocus
                          placeholder="Název subkategorie"
                          value={newSubcatName}
                          onChange={e => setNewSubcatName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); createSubcategory(); }
                            if (e.key === 'Escape') { setAddingSubcat(false); setNewSubcatName(''); }
                          }}
                        />
                        <button type="button" className="btn btn-primary btn-sm" onClick={createSubcategory}>Přidat</button>
                        <button type="button" className="btn btn-ghost btn-sm" title="Zrušit" onClick={() => { setAddingSubcat(false); setNewSubcatName(''); }}>×</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <select
                          className="input"
                          value={editData.subcategory_id}
                          disabled={editSubcats.length === 0}
                          onChange={e => setEditData(d => ({ ...d, subcategory_id: e.target.value }))}
                        >
                          <option value="">— žádná —</option>
                          {editSubcats.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ whiteSpace: 'nowrap' }}
                          disabled={!editData.category_id}
                          title={editData.category_id ? 'Přidat novou subkategorii' : 'Nejdřív vyber kategorii'}
                          onClick={() => setAddingSubcat(true)}
                        >+ Nová</button>
                      </div>
                    )}
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: 11 }}>Částka (Kč)</label>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={editData.amount}
                      onChange={e => setEditData(d => ({ ...d, amount: e.target.value }))}
                      style={{ maxWidth: 120 }}
                    />
                  </div>
                  <div className="form-group" style={{ margin: 0, gridColumn: '1 / -1' }}>
                    <label className="form-label" style={{ fontSize: 11 }}>Zpráva/Poznámka</label>
                    <input
                      className="input"
                      value={editData.note}
                      onChange={e => setEditData(d => ({ ...d, note: e.target.value }))}
                      placeholder="Co to bylo?"
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                  <button className="btn btn-ghost" onClick={() => setEditId(null)}>
                    <X size={14} /> Zrušit
                  </button>
                  <button className="btn btn-primary" onClick={() => saveEdit(tx)}>
                    <Check size={14} /> Uložit
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={tx.id}
                data-tx-id={tx.id}
                className={`tx-row${selected.has(tx.id) ? ' tx-row-selected' : ''}`}
                style={{ gridTemplateColumns: colsToGrid(cols) }}
              >
                <span className="tx-cell">
                  <input
                    type="checkbox"
                    className="tx-checkbox"
                    checked={selected.has(tx.id)}
                    onChange={() => toggleSelect(tx.id)}
                  />
                </span>
                {cols.map(c => (
                  <span key={c.key} className={`tx-cell tx-cell-${c.key}`}>
                    {c.key === 'category_name' ? (
                      catEditId === tx.id ? (
                        <select
                          className="input tx-cat-select"
                          autoFocus
                          defaultValue={tx.category_id ? String(tx.category_id) : ''}
                          onChange={e => saveCatQuick(tx, e.target.value)}
                          onBlur={() => setCatEditId(null)}
                        >
                          <option value="">— bez kategorie —</option>
                          {categories.map(cat => (
                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className="tx-cat-cell"
                          onClick={() => setCatEditId(tx.id)}
                          title="Klikněte pro změnu kategorie"
                        >
                          {tx.category_name ? (
                            <span className="tx-cat-badge" style={{
                              background: (tx.category_color || '#6366f1') + '33',
                              color: tx.category_color || '#6366f1',
                            }}>
                              {tx.category_name}
                            </span>
                          ) : (
                            <span className="tx-cat-empty">— přiřadit —</span>
                          )}
                        </span>
                      )
                    ) : renderCell(c.key, tx, categories, accountNameMap, accountById)}
                  </span>
                ))}
                <span className="tx-actions">
                  <button className="btn btn-ghost btn-icon" onClick={() => startEdit(tx)} title="Upravit">
                    <Pencil size={14} />
                  </button>
                  <button className="btn btn-ghost btn-icon" onClick={() => handleDelete(tx.id)} title="Smazat">
                    <Trash2 size={14} />
                  </button>
                </span>
              </div>
            ))}
          </div>

          {hasMore && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
              <button
                className="btn btn-ghost"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? 'Načítám…' : `Načíst dalších ${PAGE_SIZE}`}
              </button>
            </div>
          )}
        </>
      )}
    </Layout>
  );
}

function colsToGrid(cols) {
  const dataCols = cols.map(c => {
    if (c.key === 'date') return '56px';
    if (c.key === 'tx_time') return '52px';
    if (c.key === 'amount') return '110px';
    if (c.key === 'category_name') return '140px';
    if (c.key === 'subcategory_name') return '140px';
    if (c.key === 'ab_category') return '130px';
    if (c.key === 'tx_type') return '130px';
    if (c.key === 'entered_by') return '120px';
    if (c.key === 'counterparty_account') return '140px';
    if (c.key === 'flow_source' || c.key === 'flow_target') return '150px';
    return '1fr';
  }).join(' ');
  return `28px ${dataCols} 72px`;
}

function renderCell(key, tx, categories, accountNameMap, accountById) {
  switch (key) {
    case 'date':
      return <span className="tx-date">{formatDate(tx.date)}</span>;
    case 'tx_time':
      return <span className="text-muted" style={{ fontSize: 12 }}>{tx.tx_time || '—'}</span>;
    case 'description':
      // E-mailové kartové platby mají obchodníka jen v `place` → fallback, ať není řádek prázdný
      return <span className="tx-desc">{tx.description || tx.place || <span className="text-muted">—</span>}</span>;
    case 'tx_type':
      return <span className="text-muted" style={{ fontSize: 12 }}>{tx.tx_type || '—'}</span>;
    case 'category_name':
      return tx.category_name ? (
        <span className="tx-cat-badge" style={{
          background: (tx.category_color || '#6366f1') + '33',
          color: tx.category_color || '#6366f1',
        }}>
          {tx.category_name}
        </span>
      ) : <span className="text-muted" style={{ fontSize: 12 }}>—</span>;
    case 'subcategory_name':
      return <span className="text-muted" style={{ fontSize: 12 }}>{tx.subcategory_name || '—'}</span>;
    case 'ab_category':
      return <span className="text-muted" style={{ fontSize: 12 }}>{tx.ab_category || '—'}</span>;
    case 'entered_by':
      return <span style={{ fontSize: 13 }}>{tx.entered_by || '—'}</span>;
    case 'counterparty_account': {
      const accName = accountNameFor(tx.counterparty_account, accountNameMap);
      return (
        <span className="text-muted" style={{ fontSize: 12 }}>
          {tx.counterparty_account || '—'}
          {accName && <> · <span style={{ color: 'var(--text)' }}>{accName}</span></>}
        </span>
      );
    }
    case 'flow_source':
    case 'flow_target': {
      const { from, to } = accountFlow(tx, { accountById, accountNameMap });
      const val = key === 'flow_source' ? from : to;
      return (
        <span
          title={val}
          style={{ fontSize: 12, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {val}
        </span>
      );
    }
    case 'place':
      return <span style={{ fontSize: 13 }}>{tx.place || '—'}</span>;
    case 'note':
      return <span className="text-muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.note || '—'}</span>;
    case 'amount':
      return (
        <span className={`tx-amount ${tx.amount < 0 ? 'tx-amount-out' : 'tx-amount-in'}`}>
          {tx.amount < 0 ? '−' : '+'}{formatCurrency(Math.abs(tx.amount))}
        </span>
      );
    default:
      return null;
  }
}
