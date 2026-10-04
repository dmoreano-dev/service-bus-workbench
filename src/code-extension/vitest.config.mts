import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The integration tests wait on the emulator: an empty receive takes 5 seconds.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // They also share two entities, so their files must not run at the same time.
    fileParallelism: false,
  },
});
