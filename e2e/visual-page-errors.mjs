// Uncaught browser exceptions are sticky across route changes. A visible DOM
// or a successful screenshot is not evidence that the application is healthy.
export function watchPageErrors(page) {
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  return async function assertClean(checkpoint) {
    // Let the current document process queued tasks and deliver browser events
    // before declaring success. This does not replace route-specific waits.
    await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
    if(errors.length)throw Error(checkpoint+': uncaught browser errors: '+errors.join(' | '));
  };
}
