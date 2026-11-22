/** Shared semantic service pictograms.
 * These SVGs are the ONE source used by the public quick services, large
 * illustrated service cards and partner signup. Colours come from the parent.
 * Never redraw a different icon for the same service on another screen.
 */
export type TrakServiceIconKind = 'van'|'master'|'tow'|'sto'|'service'|'insurance'|'insurer';

export function TrakServiceIcon({kind}:{kind:TrakServiceIconKind}) {
  const props={
    viewBox:'0 0 48 48',fill:'none',stroke:'currentColor',strokeWidth:2.5,
    strokeLinecap:'round' as const,strokeLinejoin:'round' as const,
    'aria-hidden':true as const,focusable:'false' as const,
  };
  let shape;
  switch(kind){
    case 'van':
    case 'master':
      // Crossed roadside wrench and screwdriver, not a generic car symbol.
      shape=<>
        <path d="M34 5a10 10 0 0 0-11 13L8 33a6 6 0 0 0 8 8l15-15A10 10 0 0 0 43 15l-8 8-8-3-3-8z"/>
        <path d="m7 9 5-5 7 7-5 5zM16 15l23 23a3.5 3.5 0 0 1-5 5L12 21"/>
      </>;break;
    case 'tow':
      // Truck carried on a heavy flatbed, visibly different from a tyre shop.
      shape=<>
        <path d="M3 31h29l7 6h6v7H3V31Z"/>
        <path d="M6 31v-5h32l7 5M11 26l4-9h15l4 9"/>
        <path d="M15 17l3-6h10l3 6M18 11h10"/>
        <circle cx="12" cy="43" r="3"/><circle cx="36" cy="43" r="3"/>
        <path d="M5 25h5m24 0h6"/>
      </>;break;
    case 'sto':
    case 'service':
      // Single service garage and a vehicle inside the open bay.
      shape=<>
        <path d="M3 20 24 6l21 14v24H3V20Z"/>
        <path d="M11 44V24h26v20M11 29h26"/>
        <path d="M15 39h18l-2-5H17l-2 5ZM15 39v5m18-5v5"/>
        <circle cx="19" cy="41" r="1.2"/><circle cx="29" cy="41" r="1.2"/>
      </>;break;
    case 'insurance':
    case 'insurer':
      shape=<>
        <path d="M24 3 42 10v14c0 11-7 19-18 21C13 43 6 35 6 24V10Z"/>
        <path d="m14 24 7 7 14-16"/>
      </>;break;
  }
  return <svg {...props}>{shape}</svg>;
}
