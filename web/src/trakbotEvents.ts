/** One in-page TrakBot instance; any public shortcut asks the existing dock to open. */
export const TRAKBOT_OPEN_EVENT = 'traksos:open-trakbot';

export function requestTrakBotOpen(): void {
  window.dispatchEvent(new Event(TRAKBOT_OPEN_EVENT));
}
