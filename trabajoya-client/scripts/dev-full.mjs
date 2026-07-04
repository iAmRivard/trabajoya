import { spawn } from 'node:child_process';

const children = [
  spawn('node', ['server/index.mjs'], {
    stdio: 'inherit',
    env: process.env,
  }),
  spawn('npx', ['vite', '--host', '127.0.0.1'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_API_BASE_URL: process.env.VITE_API_BASE_URL || 'http://127.0.0.1:8787',
    },
  }),
];

let shuttingDown = false;
let exitedChildren = 0;

for (const child of children) {
  child.on('exit', (code) => {
    exitedChildren += 1;

    if (shuttingDown) {
      if (exitedChildren === children.length) {
        process.exit(0);
      }
      return;
    }

    shuttingDown = true;
    stopChildren();
    process.exit(code ?? 0);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    shuttingDown = true;
    stopChildren();
    setTimeout(() => process.exit(0), 600).unref();
  });
}

function stopChildren() {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
}
