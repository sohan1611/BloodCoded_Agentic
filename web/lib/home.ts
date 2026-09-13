export type ClickLike = {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented?: boolean;
};

/** A primary-button click with no modifier key: the only click the app may take over.
 *  Ctrl/Cmd/Shift/Alt clicks and middle clicks keep the browser's own behaviour -- new
 *  tab, new window -- so a logo that looks like a link keeps acting like one. */
export function isPlainLeftClick(event: ClickLike): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}
