import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    // A type reveal carries its own <pre>. Rendering it through CodeBlock
    // would nest a bordered figure and a second copy button inside the
    // reveal, so those render bare.
    pre: (props: React.ComponentProps<'pre'> & { 'data-twoslash-popup'?: string }) =>
      props['data-twoslash-popup'] === undefined ? (
        defaultMdxComponents.pre?.(props)
      ) : (
        <pre {...props} />
      ),
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
