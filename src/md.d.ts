declare module '*.md' {
  import type { ChapterMeta, Heading } from '../vite-plugin-markdown'
  export const meta: ChapterMeta
  export const headings: Array<Heading>
  export const hasMermaid: boolean
  export const html: string
  const _default: string
  export default _default
}
