/**
 * The demo page reached for a shadcn Button once. Two variants and one size is
 * less than a component's worth, and this migration has no ui/ directory. Two
 * files need them now, so they live here rather than drifting apart in both.
 */
export const button =
  "inline-flex items-center justify-center rounded-md font-medium text-sm transition-[colors,transform] duration-150 active:scale-95 disabled:pointer-events-none disabled:opacity-50";
export const small = "px-3 py-1.5";
export const primary =
  "bg-fd-primary text-fd-primary-foreground hover:bg-fd-primary/90";
export const outline = "border border-fd-border hover:bg-fd-accent";
