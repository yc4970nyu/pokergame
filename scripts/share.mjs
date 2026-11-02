// npm run share — build, start the game server, and open a public link via a Cloudflare Quick Tunnel.
// Friends anywhere can join with that link. No account needed; the link lasts until you press Ctrl+C.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT ?? '3001';
const bin = (name) => path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
const children = [];
const stopAll = () => { children.forEach((c) => c.kill()); process.exit(0); };
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

console.log('\n▸ 打包前端…');
const build = spawnSync(bin('vite'), ['build'], { cwd: root, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

console.log('▸ 启动服务器…');
const server = spawn(bin('tsx'), ['server/src/index.ts'], {
  cwd: root,
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, NODE_ENV: 'production', PORT },
});
children.push(server);

const lan = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => `http://${i.address}:${PORT}`);

const box = (lines) => {
  const w = Math.max(...lines.map((l) => [...l].length)) + 4;
  console.log('\n┌' + '─'.repeat(w) + '┐');
  for (const l of lines) console.log('│  ' + l + ' '.repeat(w - [...l].length - 2) + '│');
  console.log('└' + '─'.repeat(w) + '┘\n');
};

setTimeout(() => {
  if (lan.length) box(['同一个 Wi-Fi 下：', ...lan]);

  console.log('▸ 打开公网链接（Cloudflare Quick Tunnel）…');
  const tunnel = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { cwd: root });
  children.push(tunnel);
  let shown = false;
  const scan = (buf) => {
    const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(buf.toString());
    if (m && !shown) {
      shown = true;
      box(['发给朋友这个链接就能一起玩：', m[0], '', '关掉这个窗口（Ctrl+C）链接就失效。每次启动链接都会变。']);
    }
  };
  tunnel.stdout.on('data', scan);
  tunnel.stderr.on('data', scan);
  tunnel.on('error', (e) => {
    if (e.code === 'ENOENT') {
      box([
        '没找到 cloudflared，先装一下（只需要一次）：',
        '  brew install cloudflared',
        '装好后重新运行 npm run share。',
        '现在只能用上面的 Wi-Fi 地址玩。',
      ]);
    } else console.error(e);
  });
  tunnel.on('exit', (code) => { if (code && !shown) console.log(`cloudflared 退出了（代码 ${code}），公网链接没开成。`); });
}, 1500);

if (!existsSync(path.join(root, 'client', 'dist'))) console.warn('client/dist 不存在，打包可能失败了');
