import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import type { MDXComponents } from 'mdx/types';
import { Demo } from './demo';
import { Mermaid } from './mermaid';

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Demo,
    Mermaid,
    Tab,
    Tabs,
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
