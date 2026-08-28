const http = require('http');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const Vec3 = require('vec3');
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
    try {
      bot.loadPlugin(pathfinder);
      const defaultMove = new Movements(bot);
      bot.pathfinder.setMovements(defaultMove);
      console.log('[PATHFINDER SETUP] Pathfinder ready!');
    } catch (e) {
      console.log('[PATHFINDER SETUP ERROR]', e.message);
    }
  });

  // Bot actions definitions
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
      const targetBlock = bot.blockAt(new Vec3(x, y, z));
      if (!targetBlock || targetBlock.name === 'air') return "No block there.";
      try {
        await bot.dig(targetBlock);
        return `Mined ${targetBlock.name}`;
      } catch (err) {
        return `Mining error: ${err.message}`;
      }
    },

    async chatMessage({ message }) {
      bot.chat(`/me ${message}`);
      return `Sent message: ${message}`;
    }
  };

  // Universal message listener for MC 1.21 packet compatibility
  bot.on('message', async (jsonMsg, position) => {
    if (position === 'game_info') return;

    const fullText = jsonMsg.toString();
    if (!fullText.trim()) return;

    console.log(`[RAW CHAT RECEIVED] ${fullText}`);

    // Updated regex allowing dots, dashes, and standard characters in usernames
    const match = fullText.match(/^(?:<|\[)?([.\w-]+)(?:>|\])?[:\s]\s*(.+)$/);
    
    let username = null;
    let messageText = fullText;

    if (match) {
      username = match[1];
      messageText = match[2];
    }

    // Ignore self messages
    if (username === bot.username || fullText.includes(bot.username)) return;

    // Ignore messages starting with Alice or Alice:
    if (messageText.trim().toLowerCase().startsWith('alice')) return;

    const botPos = bot.entity ? bot.entity.position : { x: 0, y: 0, z: 0 };
    const sender = username || 'Player';

    const aiResult = await analyzeMessage(sender, messageText, botPos);
    if (!aiResult) return;

    if (aiResult.type === 'function') {
      const { name, args } = aiResult.action;
      console.log(`[AI ACTION] ${name}`, args);
      if (botActions[name]) {
        const res = await botActions[name](args);
        console.log(`[ACTION RESULT] ${res}`);
      }
    } else if (aiResult.type === 'text' && aiResult.text) {
      bot.chat(`/me ${aiResult.text.trim()}`);
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
