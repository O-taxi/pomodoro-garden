// Expo's tunnel WebSocket needs an explicit agent to use the cloud HTTPS proxy.
const { createRequire } = require('node:module');
const { spawn } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const projectRequire = createRequire(path.join(projectRoot, 'package.json'));

if (require.main === module) {
  const runtime = path.join(projectRoot, '.expo', 'cloud-runtime');
  mkdirSync(runtime, { recursive: true });
  const expoRoot = path.dirname(projectRequire.resolve('expo/package.json'));
  const child = spawn(process.execPath, [path.join(expoRoot, 'bin', 'cli'), 'start', '--tunnel', '--go', ...process.argv.slice(2)], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      EXPO_UNSTABLE_TUNNEL_V2: '1',
      EXPO_NO_TELEMETRY: '1',
      __UNSAFE_EXPO_HOME_DIRECTORY: process.env.__UNSAFE_EXPO_HOME_DIRECTORY || path.join(runtime, 'expo-home'),
      XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || path.join(runtime, 'cache'),
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=${JSON.stringify(__filename)}`.trim(),
    },
  });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
} else {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (proxy) {
    const expoRequire = createRequire(projectRequire.resolve('expo/package.json'));
    const tunnelRequire = createRequire(expoRequire.resolve('@expo/ws-tunnel'));
    const wsPath = tunnelRequire.resolve('ws');
    const WebSocket = tunnelRequire('ws');
    const { HttpsProxyAgent } = projectRequire('https-proxy-agent');
    class ProxiedWebSocket extends WebSocket {
      constructor(address, protocols, options) {
        const url = new URL(address);
        if (url.protocol === 'wss:' && url.hostname.endsWith('.on.expo.app')) {
          if (protocols && !Array.isArray(protocols) && typeof protocols === 'object') {
            options = protocols;
            protocols = undefined;
          }
          options = { ...options, agent: new HttpsProxyAgent(proxy) };
        }
        super(address, protocols, options);
      }
    }
    ProxiedWebSocket.WebSocket = ProxiedWebSocket;
    require.cache[wsPath].exports = ProxiedWebSocket;
  }
}
