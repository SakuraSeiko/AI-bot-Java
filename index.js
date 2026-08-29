const http = require('http');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
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

  // Rejestracja pluginu pathfinder
  bot.loadPlugin(pathfinder);

  bot.on('login', () => {
    console.log('[BOT] Successfully logged in to the server.');
  });

  // Używamy .once, aby wykonać inicjalizację fizyki tylko raz przy pierwszym spawnie
  bot.once('spawn', () => {
    console.log('[BOT] Alice spawned in the world.');
    
    try {
      const version = bot.version || '1.21';
      const mcData = require('minecraft-data')(version);
      if (mcData) {
        const defaultMove = new Movements(bot, mcData);
        bot.pathfinder.setMovements(defaultMove);
        console.log('[BOT] Pathfinder movements initialized successfully.');
      }
    } catch (err) {
      console.error('[BOT ERROR] Failed to initialize pathfinder movements:', err.message || err);
    }
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

      switch (name) {
        case 'chatMessage':
          if (args.message) bot.chat(`/me ${args.message}`);
          break;

        case 'walkTo':
          bot.pathfinder.setGoal(new goals.GoalBlock(args.x, args.y, args.z));
          bot.chat(`/me Idę na współrzędne X:${args.x} Y:${args.y} Z:${args.z}`);
          break;

        case 'followPlayer':
          const target = bot.players[args.targetUsername]?.entity;
          if (target) {
            // Podążaj za graczem z zachowaniem odległości 2 bloków
            bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true);
            bot.chat(`/me Idę za tobą, ${args.targetUsername}!`);
          } else {
            bot.chat(`/me Nie widzę gracza ${args.targetUsername}.`);
          }
          break;

        case 'stopMovement':
          bot.pathfinder.setGoal(null);
          bot.chat('/me Zatrzymałam się.');
          break;

        case 'digBlock':
          const block = bot.blockAt(require('vec3')(args.x, args.y, args.z));
          if (block && bot.canDigBlock(block)) {
            bot.dig(block).catch(err => console.error('[DIG ERROR]', err));
          } else {
            bot.chat("/me Nie mogę wykopać tego bloku.");
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
