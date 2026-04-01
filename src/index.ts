import 'dotenv/config';

import { getConfig } from './config.js';
import { createServer } from './server.js';

async function main() {
  // 启动入口只做两件事：读配置、组装服务。
  // 这样好处是 main 很薄，业务逻辑都在可测试的模块里。
  const config = getConfig();
  const server = createServer(config);

  try {
    await server.listen({
      host: config.host,
      port: config.port,
    });
  } catch (error) {
    server.log.error(error, 'Failed to start server');
    process.exitCode = 1;
  }
}

void main();

