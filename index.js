const http = require('http');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const toolPlugin = require('mineflayer-tool').plugin;
const pvp = require('mineflayer-pvp').plugin;
const { initGemini, analyzeMessage } = require('./gemini');

const PORT = process.env.PORT || 3000;

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

  // Ładowanie pluginów (bez collectblock)
  bot.loadPlugin(pathfinder);
  bot.loadPlugin(toolPlugin);
  bot.loadPlugin(pvp);

  let mcData = null;

  bot.on('login', () => {
    console.log('[BOT] Successfully logged in to the server.');
  });

  bot.once('spawn', () => {
    console.log('[BOT] Alice spawned in the world.');
    bot.physicsEnabled = true;

    try {
      const version = bot.version || '1.21';
      mcData = require('minecraft-data')(version);
      if (mcData) {
        const defaultMove = new Movements(bot, mcData);
        defaultMove.canDig = true;
        bot.pathfinder.setMovements(defaultMove);
        console.log('[BOT] Pathfinder initialized successfully.');
      }
    } catch (err) {
      console.error('[BOT ERROR] Pathfinder init error:', err.message || err);
    }
  });

  function findTargetEntity(username) {
    const cleanUser = username.toLowerCase().replace(/^\./, '');
    for (const name of Object.keys(bot.players)) {
      if (name.toLowerCase().replace(/^\./, '') === cleanUser) {
        if (bot.players[name]?.entity) return bot.players[name].entity;
      }
    }
    return Object.values(bot.entities).find(e => 
      e.type === 'player' && e.username && e.username.toLowerCase().replace(/^\./, '') === cleanUser
    );
  }

  function getNearbyBlockNames() {
    if (!bot.entity) return [];
    const blocks = bot.findBlocks({
      matching: (b) => b && b.name !== 'air' && b.name !== 'cave_air',
      maxDistance: 10,
      count: 20
    });
    const names = new Set();
    for (const pos of blocks) {
      const b = bot.blockAt(pos);
      if (b) names.add(b.name);
    }
    return Array.from(names);
  }

  function getInventoryItems() {
    return bot.inventory.items().map(item => `${item.name} x${item.count}`);
  }

  function getEquippedItems() {
    const slots = ['head', 'torso', 'legs', 'feet', 'hand', 'off-hand'];
    const equipped = [];
    for (const slot of slots) {
      const item = bot.inventory.slots[bot.getEquipmentDestSlot(slot)];
      if (item) equipped.push(`${slot}: ${item.name}`);
    }
    return equipped;
  }

  bot.on('chat', async (username, message) => {
    if (username === bot.username) return;

    console.log(`[CHAT] ${username}: ${message}`);

    const worldContext = {
      pos: {
        x: Math.floor(bot.entity.position.x),
        y: Math.floor(bot.entity.position.y),
        z: Math.floor(bot.entity.position.z)
      },
      health: bot.health || 20,
      food: bot.food || 20,
      inventory: getInventoryItems(),
      equipment: getEquippedItems(),
      nearbyBlocks: getNearbyBlockNames()
    };

    const result = await analyzeMessage(username, message, worldContext);
    if (!result) return;

    if (result.type === 'text') {
      bot.chat(`/me ${result.text}`);
    } else if (result.type === 'function') {
      const { name, args } = result.action;
      console.log(`[ACTION] Executing ${name} with args:`, args);

      if (name === 'interactWithWorld') {
        const { action, target, sayInChat } = args;

        if (sayInChat) {
          bot.chat(`/me ${sayInChat}`);
        }

        switch (action) {
          case 'follow':
            const playerToFollow = findTargetEntity(username);
            if (playerToFollow) {
              bot.pathfinder.setGoal(new goals.GoalFollow(playerToFollow, 2), true);
            } else {
              bot.chat('/me Nie widzę Cię w pobliżu.');
            }
            break;

          case 'stop':
            bot.pathfinder.setGoal(null);
            break;

          case 'toss_item':
            const itemKw = (target || '').toLowerCase();
            const itemToDrop = bot.inventory.items().find(i => i.name.toLowerCase().includes(itemKw));
            if (itemToDrop) {
              bot.tossStack(itemToDrop).catch(err => console.error('[TOSS ERROR]', err));
            }
            break;

          case 'eat':
            const foodKw = (target || '').toLowerCase();
            const foodItem = bot.inventory.items().find(i => i.name.toLowerCase().includes(foodKw));
            if (foodItem) {
              bot.equip(foodItem, 'hand')
                .then(() => bot.consume())
                .catch(err => console.error('[EAT ERROR]', err));
            }
            break;

          case 'equip':
            const gearKw = (target || '').toLowerCase();
            const gearItem = bot.inventory.items().find(i => i.name.toLowerCase().includes(gearKw));
            if (gearItem) {
              bot.equip(gearItem, 'hand').catch(err => console.error('[EQUIP ERROR]', err));
            }
            break;
        }
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
