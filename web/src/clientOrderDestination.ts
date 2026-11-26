/** Route only a newly authorized searching order into the desktop client
 * workspace. Payment, approval and other order states keep the full order
 * route; native and narrow web use their existing layout. No storage of IDs. */
export function clientOrderDestination(result: {
  order: {id: string; status?: string; you?: string};
  confirmationUrl?: string | null;
}, desktopClient: boolean): string {
  const id = encodeURIComponent(result.order.id);
  return desktopClient && !result.confirmationUrl &&
    result.order.status === 'searching' && result.order.you === 'client'
    ? '?order=' + id
    : 'order/' + id;
}
