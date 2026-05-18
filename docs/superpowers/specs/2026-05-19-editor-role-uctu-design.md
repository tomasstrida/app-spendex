# Editor role účtu v Importu

**Datum:** 2026-05-19
**Stránka:** Import z Air Bank (`client/src/pages/ImportPage.jsx`, komponenta `AccountSelector`)

## Problém

Roli existujícího účtu nelze v UI změnit. `AccountSelector` umožňuje jen výběr účtu a založení *nového* účtu s rolí. Backend `PATCH /api/accounts/:id` změnu role podporuje (`VALID_ROLES` vč. `income`, na produkci nasazeno v main), ale klient k tomu nemá ovládací prvek. Konkrétní blokující potřeba: přepnout účet „Hlavní" z `ignored` na `income`, aby fungovala detekce příjmů.

## Cíl

U vybraného účtu v Importu umožnit změnu role přes malý `<select>`, který volá `PATCH /api/accounts/:id` a okamžitě promítne změnu do UI.

## Návrh

Pouze frontend, `client/src/pages/ImportPage.jsx`.

**`AccountSelector`:**
- Když je `selectedId` nastaveno a účet nalezen, pod stávajícím `ROLE_HINTS[acc.role]` hintem vykreslit `<select className="input">` s možnostmi z `ROLE_LABELS` (stejný vzor jako select při zakládání účtu), `value={acc.role}`.
- `onChange`: zavolat `PATCH /api/accounts/${acc.id}` s tělem `{ role: newRole }`, `Content-Type: application/json`.
  - Úspěch: zavolat nový prop callback `onUpdated(updatedAccount)` (analogie stávajícího `onCreated`), který v `ImportPage` nahradí daný účet v `accounts` stavu → label v rozbalovátku i hint se přerenderují.
  - Chyba: zobrazit chybovou hlášku stejným způsobem jako formulář zakládání účtu (`alert alert-error`, krátký text z `d.error` nebo „Chyba.").
- Stav ukládání (`savingRole`) zakáže select po dobu requestu.

**`ImportPage`:**
- Přidat handler `handleAccountUpdated(acc)` → `setAccounts(prev => prev.map(a => a.id === acc.id ? acc : a))`.
- Předat `onUpdated={handleAccountUpdated}` do `AccountSelector`.

## Mimo rozsah (YAGNI)

- Editace názvu / čísla účtu (PATCH to umí, ale teď nepotřeba).
- Potvrzovací dialog (změna role je vratná).
- Mazání účtu, samostatná stránka správy účtů.
- Backend změny, nové testy (žádné route/JSX testy v projektu; ověření = Vite build).

## Rizika / dopad

- Změna role účtu mění, jak se transakce z něj počítají (spending/fixed/ignored/income) — to je záměr feature, žádné dodatečné přepočty se netriggerují (čte se vždy živě z DB při dotazech).
- Konzistence: `ROLE_LABELS`/`ROLE_HINTS` už `income` obsahují (Task 5). Žádný nový stav rolí.
- Build-only ověření; backend a testy se nemění.
