const http = require('http');
const mineflayer = require('mineflayer');
const { pathfinder, movements, goals } = require('mineflayer-pathfinder');
const { initGemini, analyzeMessage } = require('./gemini');

const PORT = process.env.PORT || 3000;

// HTTP server required for Render uptime checks
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
  if (!process.env.GEMINI_API_KEY) {
    console.error('[ERROR] GEMINI_API_KEY environment variable is missing!');
    return;
  }

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
    // Ładowanie nawigacji dopiero PO wejściu bota do gry
    try {
      bot.loadPlugin(pathfinder);
      const defaultMove = new movements(bot);
      bot.pathfinder.setMovements(defaultMove);
    } catch (e) {
      console.log('[PATHFINDER SETUP]', e.message);
    }
  });

  // Definicje akcji bota
  const botActions = {
    async walkTo({ x, y, z }) {
      bot.pathfinder.setGoal(new goals.GoalBlock(x, y, z));
      return `Walking to X:${x} Y:${y} Z:${z}`;
    },

    async followPlayer({ targetUsername }) {
      const player = bot.players[targetUsername]?.entity;
      if (!player) return `Player ${targetUsername} not visible.`;
      bot.pathfinder.setGoal(new goals.GoalFollow(player, 2), true);
      return `Following ${targetUsername}`;
    },

    async digBlock({ x, y, z }) {
      const targetBlock = bot.blockAt(bot.vec3(x, y, z));
      if (!targetBlock || targetBlock.name === 'air') return "No block there.";
      try {
        await bot.dig(targetBlock);
        return `Mined ${targetBlock.name}`;
      } catch (err) {
        return `Mining error: ${err.message}`;
      }
    },

    async chatMessage({ message }) {
      bot.chat(message);
      return `Sent message: ${message}`;
    }
  };

  bot.on('chat', async (username, message) => {
    if (username === bot.username) return;

    console.log(`[CHAT] ${username}: ${message}`);
    const botPos = bot.entity ? bot.entity.position : { x: 0, y: 0, z: 0 };

    const aiResult = await analyzeMessage(username, message, botPos);
    if (!aiResult) return;

    if (aiResult.type === 'function') {
      const { name, args } = aiResult.action;
      console.log(`[AI ACTION] ${name}`, args);
      if (botActions[name]) {
        const res = await botActions[name](args);
        console.log(`[ACTION RESULT] ${res}`);
      }
    } else if (aiResult.type === 'text' && aiResult.text) {
      bot.chat(aiResult.text.trim());
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
