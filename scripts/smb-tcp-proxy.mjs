import net from 'node:net';

function readArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const targetHost = readArgument('--target-host');
const targetPort = Number(readArgument('--target-port', '445'));
const listenPort = Number(readArgument('--listen-port', '1445'));

if (!targetHost || !Number.isInteger(targetPort) || !Number.isInteger(listenPort)) {
  throw new Error('Valid --target-host, --target-port, and --listen-port values are required.');
}

const server = net.createServer((client) => {
  const upstream = net.connect(targetPort, targetHost);
  client.on('error', () => upstream.destroy());
  upstream.on('error', () => client.destroy());
  client.pipe(upstream).pipe(client);
});

server.listen(listenPort, '127.0.0.1');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
