import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Server tests (tests/**) run in node, matching the Fastify backend they exercise.
// Web tests (tests/web/**) run in jsdom, matching the React SPA in src/web/. Each
// project only loads its own setupFiles/plugins, so @testing-library/jest-dom and the
// React JSX transform never touch the node-environment server suite.
//
// Phase 6 Task 1 (flake sweep): the four files below each spin up a REAL local aedes
// MQTT broker (net.Server + Aedes.createBroker()) to test mqtt.js-based code against
// actual wire protocol traffic (see each file's own header comment for the rationale).
// Each broker already binds to an OS-assigned ephemeral port (`listen(0, ...)`), so
// there is no literal port collision between them. The flake documented since Phase 3
// (docs/superpowers/reviews/phase3/progress.md, phase5/final-review-report.md T6) is a
// genuine stream-level bug, empirically reproduced during Phase 6 hardening: running
// these 4 files' vitest worker threads concurrently with each other (independent of the
// rest of the suite -- reproduced with ONLY these 4 files selected, no other files
// running) occasionally corrupts an mqtt.js client's read stream, which its parser then
// rejects with "Invalid header flag bits, must be 0x0 for puback packet"
// (node_modules/mqtt-packet/parser.js) -- a stream/TCP-framing desync under CPU
// contention between several simultaneous real MQTT protocol exchanges, not a bug in
// this repo's source. Isolating these 4 files into their own project with
// `fileParallelism: false` makes them run one at a time RELATIVE TO EACH OTHER ONLY
// (they still run concurrently with the rest of the "server" project's ~120 files),
// which eliminates the simultaneous-real-broker condition that triggers the corruption
// without serializing the whole suite. See tests/ingest/mqttSource.test.ts and
// tests/ingest/haPublisher.test.ts's own header comments for the per-file flake notes.
const MQTT_BROKER_TEST_FILES = [
  'tests/ingest/mqttSource.test.ts',
  'tests/ingest/haPublisher.test.ts',
  'tests/notify/mqttSender.test.ts',
  'tests/automation/engine.test.ts',
];

export default defineConfig({
  test: {
    // 30s (vs the 5s default): the shared CI runner also builds multi-arch Docker
    // images, sometimes concurrently with a test job, and under that CPU starvation
    // real-I/O tests (websockets, MQTT brokers, on-disk SQLite) intermittently blow a
    // 5s budget — two releases died on two DIFFERENT such flakes. Assertion failures
    // still fail immediately; only genuinely hung tests report slower.
    testTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/web/**', ...MQTT_BROKER_TEST_FILES],
        },
      },
      {
        extends: true,
        test: {
          name: 'server-mqtt-broker',
          environment: 'node',
          include: MQTT_BROKER_TEST_FILES,
          // See the comment above MQTT_BROKER_TEST_FILES: these files each run a real
          // aedes broker and must not race each other's protocol I/O.
          fileParallelism: false,
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['tests/web/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/web/setup.ts'],
        },
      },
    ],
  },
});
