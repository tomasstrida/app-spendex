// Stav push notifikací na TOMTO zařízení. Klíčové je porovnání prohlížeče se serverem:
// když server odběr nezná (smazal ho po 410 nebo se PWA přeinstalovala), push mizí do prázdna
// a bez tohoto porovnání se to nikdy nepozná.
//
// serverEndpoints = null znamená „server se nepodařilo zeptat" — pak stav nehádáme.
export function resolvePushState({ supported, permission, localEndpoint, serverEndpoints }) {
  if (!supported) return 'unsupported';
  if (permission === 'denied') return 'denied';
  if (!localEndpoint) return 'off';
  if (!Array.isArray(serverEndpoints)) return 'on';
  return serverEndpoints.includes(localEndpoint) ? 'on' : 'desync';
}
