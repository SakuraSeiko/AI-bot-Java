const http = require('http');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const pvp = require('mineflayer-pvp').plugin;
const collectBlock = require('mineflayer-collectblock').plugin;
const autoEat = require('mineflayer-auto-eat').plugin;
const armorManager = require('mineflayer-armor-manager');
const Vec3 = require('vec3');
const { initGemini, analyzeMessage } = require('./gemini');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Alice AI Bot Service (Full Arsenal) is active.\n');
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
      // Ładujemy absolutnie WSZYSTKIE kluczowe pluginy
      bot.loadPlugin(pathfinder);
      bot.loadPlugin(pvp);
      bot.loadPlugin(collectBlock);
      bot.loadPlugin(autoEat);
      bot.loadPlugin(armorManager);

      const defaultMove = new Movements(bot);
      defaultMove.allow1by1towers = true;
      bot.pathfinder.setMovements(defaultMove);

      // Konfiguracja auto-jedzenia (żeby dbała o siebie)
      if (bot.autoEat) {
        bot.autoEat.options = {
          priority: 'food',
          startEating: 14,
          bannedFood: []
        };
      }

      console.log('[FULL ARSENAL] All plugins loaded and configured!');
    } catch (e) {
      console.log('[PLUGIN SETUP ERROR]', e.message);
    }
  });

  // Pełny rejestr akcji udostępniający 100% możliwości bota dla AI
  const botActions = {
    async walkTo({ x, y, z }) {
      try {
        await bot.pathfinder.goto(new goals.GoalBlock(x, y, z));
        return `Arrived at X:${x} Y:${y} Z:${z}`;
      } catch (err) {
        return `Navigation error: ${err.message}`;
      }
    },

    async followPlayer({ targetUsername }) {
      const player = bot.players[targetUsername]?.entity;
      if (!player) return `Player ${targetUsername} not visible.`;
      bot.pathfinder.setGoal(new goals.GoalFollow(player, 2), true);
      return `Now following ${targetUsername}`;
    },

    async stopEverything() {
      bot.pathfinder.stop();
      bot.pvp.stop();
      if (bot.collectBlock) bot.collectBlock.cancel();
      return `Stopped all movement, combat, and collection.`;
    },

    async lookAtCoords({ x, y, z }) {
      await bot.lookAt(new Vec3(x, y, z));
      return `Looking at X:${x} Y:${y} Z:${z}`;
    },

    async findAndCollect({ blockName }) {
      const blockType = bot.registry.blocksByName[blockName];
      if (!blockType) return `Unknown block type: ${blockName}`;

      const block = bot.findBlock({ matching: blockType.id, maxDistance: 32 });
      if (!block) return `No ${blockName} found within 32 blocks.`;

      try {
        await bot.collectBlock.collect(block);
        return `Successfully collected ${blockName}`;
      } catch (err) {
        return `Collection failed: ${err.message}`;
      }
    },

    async attackMob({ mobName }) {
      const entity = bot.nearestEntity((e) => {
        return e.type === 'mob' && e.name && e.name.toLowerCase().includes(mobName.toLowerCase());
      });
      if (!entity) return `No targetable mob matching "${mobName}" found nearby.`;
      
      bot.pvp.attack(entity);
      return `Attacking ${entity.name}`;
    },

    async listInventory() {
      const items = bot.inventory.items();
      if (items.length === 0) return "Inventory is empty.";
      return items.map(i => `${i.count}x ${i.name}`).join(', ');
    },

    async equipItem({ itemName, destination }) {
      const item = bot.inventory.items().find(i => i.name.includes(itemName));
      if (!item) return `Item ${itemName} not found in inventory.`;
      try {
        await bot.equip(item, destination || 'hand');
        return `Equipped ${itemName} to ${destination || 'hand'}`;
      } catch (err) {
        return `Equip failed: ${err.message}`;
      }
    },

    async chatMessage({ message }) {
      bot.chat(`/me ${message}`);
      return `Sent message: ${message}`;
    }
  };

  bot.on('message', async (jsonMsg, position) => {
    if (position === 'game_info') return;

    const fullText = jsonMsg.toString();
    if (!fullText.trim()) return;

    console.log(`[RAW CHAT RECEIVED] ${fullText}`);

    const match = fullText.match(/^(?:<|\[)?([.\w-]+)(?:>|\])?[:\s]\s*(.+)$/);
    let username = null;
    let messageText = fullText;

    if (match) {
      username = match[1];
      messageText = match[2];
    }

    if (username === bot.username || fullText.includes(bot.username)) return;
    if (messageText.trim().toLowerCase().startsWith('alice')) return;

    const botPos = bot.entity ? bot.entity.position : { x: 0, y: 0, z: 0 };
    const sender = username || 'Player';

    // Kontekst środowiskowy dla AI obejmujący stan bota i otoczenie
    const nearbyEntities = Object.values(bot.entities)
      .filter(e => e.position.distanceTo(botPos) < 16 && e !== bot.entity)
      .map(e => `${e.name || e.type} at (${Math.round(e.position.x)}, ${Math.round(e.position.y)}, ${Math.round(e.position.z)})`)
      .slice(0, 5)
      .join(', ');

    const contextData = {
      position: botPos,
      health: bot.health,
      food: bot.food,
      inventorySummary: bot.inventory.items().map(i => `${i.count}x ${i.name}`).join(', ') || 'empty',
      nearby: nearbyEntities || 'nothing special'
    };

    const aiResult = await analyzeMessage(sender, messageText, contextData);
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
