// Playwright must perform a real pointer action; do not force a hidden or
// covered control. Verify an independent postcondition after the action.
export async function clickWorkingAction(locator,verify,timeout=10000){
  await locator.waitFor({state:'visible',timeout});
  await locator.click({timeout});
  await verify();
}
