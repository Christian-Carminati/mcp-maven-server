import { createServer, startServer } from './core/server.js';
import { registerAllTools } from './tools/index.js';

async function main() {
  const { server, context } = createServer();
  registerAllTools(server, context);
  await startServer(server);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
