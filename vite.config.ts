import tailwindcss from '@tailwindcss/vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackRouter } from '@tanstack/router-plugin/vite'

import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { markdown } from './vite-plugin-markdown.ts'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  // src/migration is a separate project with its own vitest, and its tests
  // need the fumadocs plugins this config does not load
  test: { exclude: ['**/node_modules/**', 'src/migration/**'] },
  plugins: [
    markdown(),
    devtools(),
    tailwindcss(),
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    viteReact(),
  ],
})

export default config
