/** One in-page TrakBot instance; any public shortcut asks the existing dock to open. */
export const TRAKBOT_OPEN_EVENT = 'traksos:open-trakbot';

export function requestTrakBotOpen(opener: HTMLElement): void {
  opener.dispatchEvent(new Event(TRAKBOT_OPEN_EVENT, { bubbles: true }));
}
