// Shared formatting helpers for the FC Configuration page (fcconfig.jsx) and the
// Flight Controller page's Ethernet (NET_*) section (flightcontroller.jsx).

// '—' for null/undefined, otherwise the value unchanged
export function fmt(v) {
  return (v === null || v === undefined) ? '—' : v;
}

// '—' for null/undefined, else On/Off for a 0/1 (or boolean) flag param
export function onoff(v) {
  return (v === null || v === undefined) ? '—' : (v ? 'On' : 'Off');
}

// Bootstrap badge colour for a parameter-download state
export function stateVariant(state) {
  switch (state) {
    case 'complete': return 'success';
    case 'downloading': return 'info';
    case 'partial': return 'warning';
    case 'failed': return 'danger';
    default: return 'secondary';
  }
}
