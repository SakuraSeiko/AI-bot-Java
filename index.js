const http = require('http');
const mineflayer = require('mineflayer');
const { initGemini, analyzeMessage } = require('./gemini');

const PORT = process.env.PORT || 3000;

// Serwer HTTP dla utrzymania usługi (np. na Render)
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Alice AI Bot Service is active.\n');
});

server.listen(PORT, () => {
  console.log(`[SYSTEM] Web server listening on port ${PORT}`);
  initGemini();
  initBot();
});

function initBot() {
  console.log('[BOT] Connecting to EsnaSeiko.aternos.me:51316...');

  const bot = mineflayer.createBot({
    host: 'EsnaSeiko.aternos.me',
    port: 51316,
    username: 'Alice',
    version: '1.21'
  });

  bot.on('login', () => {
    console.log('[BOT] Successfully logged in to the server.');
  });

  bot.on('spawn', () => {
    console.log('[BOT] Alice spawned in the world.');
  });

  bot.on('chat', async (username, message) => {
    if (username === bot.username) return;

    console.log(`[CHAT] ${username}: ${message}`);

    const result = await analyzeMessage(username, message, bot.entity.position);
    if (!result) return;

    if (result.type === 'text') {
      bot.chat(`/me ${result.text}`);
    } else if (result.type === 'function') {
      const { name, args } = result.action;
      console.log(`[ACTION] Executing ${name} with args:`, args);

      // Podstawowa obsługa natywnych akcji Mineflayera (bez zewnętrznych pluginów)
      switch (name) {
        case 'chatMessage':
          if (args.message) bot.chat(`/me ${args.message}`);
          break;
        case 'walkTo':
          bot.lookAt(require('vec3')(args.x, args.y, args.z));
          bot.setControlState('forward', true);
          setTimeout(() => bot.setControlState('forward', false), 2000);
          break;
        case 'followPlayer':
          const target = bot.players[args.targetUsername]?.entity;
          if (target) {
            bot.lookAt(target.position.offset(0, 1.6, 0));
            bot.setControlState('forward', true);
            setTimeout(() => bot.setControlState('forward', false), 2000);
          } else {
            bot.chat(`/me I can't see ${args.targetUsername}.`);
          }
          break;
        case 'digBlock':
          const block = bot.blockAt(require('vec3')(args.x, args.y, args.z));
          if (block && bot.canDigBlock(block)) {
            bot.dig(block).catch(err => console.error('[DIG ERROR]', err));
          } else {
            bot.chat("/me I cannot dig that block.");
          }
          break;
      }
    }
  });

  bot.on('error', (err) => {
    console.error('[BOT ERROR]', err.message || err);
  });

  bot.on('end', (reason) => {
    console.log(`[BOT] Disconnected (${reason}). Reconnecting in 10 seconds...`);
    setTimeout(initBot, 10000);
  });
}
