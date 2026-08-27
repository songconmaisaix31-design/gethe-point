import type { CSSProperties } from "react";

import { UI_CSS_VARIABLES, UI_TOKENS } from "./contracts";

export type TokenStyle = CSSProperties &
  Readonly<Record<`--${string}`, string | number>>;

export const UI_TOKEN_STYLE: TokenStyle = {
  ...UI_CSS_VARIABLES,
  "--font-size-body": `${String(UI_TOKENS.typography.bodyPx)}px`,
  "--font-size-heading": `${String(UI_TOKENS.typography.headingPx)}px`,
  "--font-size-subject-body": `${String(UI_TOKENS.typography.subjectBodyPx)}px`,
  "--font-size-subject-heading": `${String(UI_TOKENS.typography.subjectHeadingPx)}px`,
  "--line-height-body": UI_TOKENS.typography.bodyLineHeight,
  "--line-height-subject": UI_TOKENS.typography.subjectLineHeight,
  "--radius-small": `${String(UI_TOKENS.radiusPx.small)}px`,
  "--radius-medium": `${String(UI_TOKENS.radiusPx.medium)}px`,
  "--radius-large": `${String(UI_TOKENS.radiusPx.large)}px`,
  "--target-default": `${String(UI_TOKENS.targetPx.defaultMinimum)}px`,
  "--target-subject": `${String(UI_TOKENS.targetPx.subjectPrimaryMinimum)}px`,
  "--focus-width": `${String(UI_TOKENS.focus.widthPx)}px`,
  "--focus-offset": `${String(UI_TOKENS.focus.offsetPx)}px`,
  "--motion-fast": `${String(UI_TOKENS.motionMs.fast)}ms`,
  "--motion-standard": `${String(UI_TOKENS.motionMs.standard)}ms`,
};
