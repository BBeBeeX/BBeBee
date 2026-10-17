import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    include: [
      'renderer/**/*.test.{ts,tsx}',
      'sidecar/**/*.test.{ts,tsx}',
      'tests/**/*.test.{ts,tsx}',
    ],
    environment: 'node',
  },
})
