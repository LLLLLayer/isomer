import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'renderer',
          environment: 'happy-dom',
          include: ['src/renderer/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
})
