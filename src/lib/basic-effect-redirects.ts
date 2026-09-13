export const basicEffectRedirects = {
  "01-why-effect": "01-effect-model",
  "02-three-channels": "01-effect-model",
  "03-building-effects": "02-composition",
  "04-effect-gen": "02-composition",
  "05-errors": "03-typed-errors",
  "06-schema": "04-schemas",
  "07-services": "06-services",
  "08-layers-and-config": "07-layers",
  "09-capstone": "08-capstone",
  "10-testing": "09-testing",
  "11-design-thinking": "05-design",
} as const;

export const oldBasicEffectPaths = Object.keys(basicEffectRedirects).map(
  (slug) => `/learn/basic-effect/${slug}`,
);

export const redirectBasicEffectPath = (
  slugs: ReadonlyArray<string>,
): string | undefined => {
  if (slugs.length !== 2 || slugs[0] !== "basic-effect") return undefined;

  const target =
    basicEffectRedirects[slugs[1] as keyof typeof basicEffectRedirects];

  return target === undefined ? undefined : `/learn/basic-effect/${target}`;
};
