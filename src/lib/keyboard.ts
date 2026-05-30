/** Keyboard helpers shared by the chat inputs. */

/** Minimal shape of the keydown info we need — keeps this testable in node. */
export interface KeyInfo {
  key: string;
  shiftKey: boolean;
  /** True while an IME composition is in progress (Korean/Japanese/Chinese). */
  isComposing: boolean;
  /** Legacy composition marker some engines still report (key code 229). */
  keyCode?: number;
}

/**
 * Whether a keydown should submit the message (plain Enter, no Shift).
 *
 * Crucially returns `false` while an IME composition is active. Pressing Enter
 * to *commit* a composing character (e.g. the last Hangul syllable) fires a
 * keydown with `isComposing === true`; submitting there commits the character
 * and then re-inserts it, duplicating the last character. Letting that Enter
 * fall through commits the composition, and a subsequent Enter submits.
 */
export function isEnterSubmit(e: KeyInfo): boolean {
  if (e.isComposing || e.keyCode === 229) return false;
  return e.key === "Enter" && !e.shiftKey;
}
