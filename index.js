const http = require('http');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const toolPlugin = require('mineflayer-tool').plugin;
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

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(toolPlugin);

  let mcData = null;
  let isProcessing = false;
  const chatHistory = [];
  const MAX_HISTORY = 50;

  function pushToHistory(role, sender, text) {
    chatHistory.push({ role, sender, text });
    if (chatHistory.length > MAX_HISTORY) {
      chatHistory.shift();
    }
  }

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

  function getNearbyEntities() {
    if (!bot.entity) return [];
    const entities = Object.values(bot.entities).filter(e => 
      e !== bot.entity && e.position.distanceTo(bot.entity.position) < 15
    );
    return entities.map(e => e.name || e.username || e.type).filter(Boolean);
  }

  function getNearbyDroppedItems() {
    if (!bot.entity) return [];
    const items = Object.values(bot.entities).filter(e => 
      e.name === 'item' && e.position.distanceTo(bot.entity.position) < 15
    );
    return items.map(i => {
      const metadata = i.metadata || [];
      return 'dropped_item';
    });
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

  function buildWorldContext() {
    return {
      pos: {
        x: Math.floor(bot.entity.position.x),
        y: Math.floor(bot.entity.position.y),
        z: Math.floor(bot.entity.position.z)
      },
      health: bot.health || 20,
      food: bot.food || 20,
      inventory: getInventoryItems(),
      equipment: getEquippedItems(),
      nearbyBlocks: getNearbyBlockNames(),
      nearbyEntities: getNearbyEntities(),
      nearbyItems: getNearbyDroppedItems()
    };
  }

  async function internalThought(thoughtMessage) {
    pushToHistory('user', 'System', thoughtMessage);
    const worldContext = buildWorldContext();

    const thoughtResult = await analyzeMessage('System', thoughtMessage, worldContext, chatHistory);
    
    let botReply = '';
    if (thoughtResult && thoughtResult.type === 'text') {
      botReply = thoughtResult.text;
    } else if (thoughtResult && thoughtResult.type === 'function' && thoughtResult.action.args.sayInChat) {
      botReply = thoughtResult.action.args.sayInChat;
    }

    if (botReply) {
      console.log(`[INTERNAL THOUGHT LOGGED] ${botReply}`);
      pushToHistory('assistant', 'Alice', botReply);
    }
  }

  async function executeSingleAction(actionObj, username) {
    const { action, target, count } = actionObj;
    console.log(`[EXECUTE ACTION] Type: ${action}, Target: ${target}, Count: ${count}`);

    switch (action) {
      case 'follow':
        const playerToFollow = findTargetEntity(username);
        if (playerToFollow) {
          bot.pathfinder.setGoal(new goals.GoalFollow(playerToFollow, 2), true);
          await new Promise(resolve => setTimeout(resolve, 3000));
        } else {
          bot.chat('/me Cannot find you nearby.');
        }
        break;

      case 'stop':
        bot.pathfinder.setGoal(null);
        break;

      case 'mine':
        const blockKw = (target || '').toLowerCase();
        const targetCount = Number(count) || 5;
        let minedCount = 0;

        for (let i = 0; i < targetCount; i++) {
          const targetBlock = bot.findBlock({
            matching: (b) => b && b.name !== 'air' && b.name.toLowerCase().includes(blockKw),
            maxDistance: 32
          });

          if (!targetBlock) break;

          console.log(`[MINING] Targeting block ${targetBlock.name} at position ${targetBlock.position} (${i + 1}/${targetCount})`);
          const defaultGoal = new goals.GoalBlock(targetBlock.position.x, targetBlock.position.y, targetBlock.position.z);

          try {
            await bot.pathfinder.goto(defaultGoal);
            const freshBlock = bot.blockAt(targetBlock.position);
            if (freshBlock && freshBlock.name !== 'air') {
              if (bot.tool && bot.tool.equipForBlock) {
                await bot.tool.equipForBlock(freshBlock);
              }
              await bot.dig(freshBlock);
              minedCount++;

              // Auto-step to collect dropped item
              await new Promise(r => setTimeout(r, 300));
              const pickupGoal = new goals.GoalBlock(targetBlock.position.x, targetBlock.position.y, targetBlock.position.z);
              await bot.pathfinder.goto(pickupGoal).catch(() => {});
            }
          } catch (err) {
            console.error('[MINE ERROR]', err.message || err);
            break;
          }
        }

        if (minedCount === 0) {
          await internalThought(`Attempted to mine ${target}, but could not find any matching block nearby.`);
        } else if (minedCount < targetCount) {
          await internalThought(`Finished mining. Mined ${minedCount} out of requested ${targetCount} blocks of ${target}.`);
        } else {
          await internalThought(`Successfully finished mining task! Mined all ${targetCount} blocks of ${target}.`);
        }
        break;

      case 'toss_item':
        const itemKw = (target || '').toLowerCase();
        const dropAmount = Number(count) || null;
        const itemToDrop = bot.inventory.items().find(i => i.name.toLowerCase().includes(itemKw));

        if (itemToDrop) {
          try {
            if (dropAmount && dropAmount < itemToDrop.count) {
              await bot.toss(itemToDrop.type, itemToDrop.metadata, dropAmount);
              await internalThought(`Successfully dropped ${dropAmount} of ${itemToDrop.name} on the ground.`);
            } else {
              await bot.tossStack(itemToDrop);
              await internalThought(`Successfully dropped all ${itemToDrop.name} on the ground.`);
            }
          } catch (err) {
            console.error('[TOSS ERROR]', err.message || err);
          }
        } else {
          await internalThought(`Wanted to drop ${target}, but it was not found in inventory.`);
        }
        break;

      case 'pickup':
        const droppedItem = Object.values(bot.entities).find(e => 
          e.name === 'item' && e.position.distanceTo(bot.entity.position) < 20
        );

        if (droppedItem) {
          try {
            const goal = new goals.GoalBlock(
              Math.floor(droppedItem.position.x),
              Math.floor(droppedItem.position.y),
              Math.floor(droppedItem.position.z)
            );
            await bot.pathfinder.goto(goal);
            await new Promise(resolve => setTimeout(resolve, 800));
            await internalThought(`Walked to dropped item and picked it up.`);
          } catch (err) {
            console.error('[PICKUP ERROR]', err.message || err);
          }
        } else {
          await internalThought(`Tried to pick up items, but found no dropped items nearby.`);
        }
        break;

      case 'attack':
        const mobKw = (target || '').toLowerCase();
        const mob = Object.values(bot.entities).find(e => 
          e.name && e.name.toLowerCase().includes(mobKw) && e.position.distanceTo(bot.entity.position) < 30
        );

        if (mob) {
          try {
            const weapon = bot.inventory.items().find(i => i.name.includes('sword') || i.name.includes('axe'));
            if (weapon) {
              await bot.equip(weapon, 'hand');
            }
            bot.pathfinder.setGoal(new goals.GoalFollow(mob, 1), true);
            
            for (let i = 0; i < 6; i++) {
              if (!bot.entities[mob.id]) break;
              await bot.attack(mob);
              await new Promise(r => setTimeout(r, 700));
            }
            bot.pathfinder.setGoal(null);
            await internalThought(`Attacked entity ${target}.`);
          } catch (err) {
            console.error('[ATTACK ERROR]', err.message || err);
          }
        } else {
          await internalThought(`Tried to hunt ${target}, but could not find any matching entity nearby.`);
        }
        break;

      case 'craft':
        const recipeKw = (target || '').toLowerCase();
        const craftCount = Number(count) || 1;

        if (mcData) {
          const itemRecipe = mcData.recipesByName[recipeKw] || Object.keys(mcData.recipesByName)
            .filter(k => k.includes(recipeKw))
            .map(k => mcData.recipesByName[k])[0];

          if (itemRecipe && itemRecipe[0]) {
            try {
              const recipe = itemRecipe[0];
              const craftingTable = bot.findBlock({
                matching: b => b && b.name === 'crafting_table',
                maxDistance: 5
              });
              await bot.craft(recipe, craftCount, craftingTable);
              await internalThought(`Successfully crafted ${craftCount} of ${recipeKw}.`);
            } catch (err) {
              console.error('[CRAFT ERROR]', err.message || err);
              await internalThought(`Tried to craft ${recipeKw}, but missing ingredients or crafting table.`);
            }
          } else {
            await internalThought(`Could not find a valid crafting recipe for ${recipeKw}.`);
          }
        }
        break;

      case 'place':
        const placeKw = (target || '').toLowerCase();
        const itemToPlace = bot.inventory.items().find(i => i.name.toLowerCase().includes(placeKw));

        if (itemToPlace) {
          try {
            await bot.equip(itemToPlace, 'hand');
            const referenceBlock = bot.blockAt(bot.entity.position.offset(0, -1, 1));
            if (referenceBlock) {
              await bot.placeBlock(referenceBlock, new mineflayer.vec3(0, 1, 0));
              await internalThought(`Placed block ${itemToPlace.name} on the ground.`);
            }
          } catch (err) {
            console.error('[PLACE ERROR]', err.message || err);
          }
        } else {
          await internalThought(`Tried to place ${target}, but do not have it in inventory.`);
        }
        break;

      case 'sleep':
        const bedBlock = bot.findBlock({
          matching: b => b && b.name.includes('bed'),
          maxDistance: 10
        });

        if (bedBlock) {
          try {
            await bot.sleep(bedBlock);
            await internalThought(`Successfully went to sleep in bed.`);
          } catch (err) {
            console.error('[SLEEP ERROR]', err.message || err);
            await internalThought(`Tried to sleep, but issue occurred: ${err.message}`);
          }
        } else {
          await internalThought(`Tried to sleep, but could not find a bed nearby.`);
        }
        break;

      case 'eat':
        const foodKw = (target || '').toLowerCase();
        const foodItem = bot.inventory.items().find(i => i.name.toLowerCase().includes(foodKw));
        if (foodItem) {
          try {
            await bot.equip(foodItem, 'hand');
            await bot.consume();
            await internalThought(`Successfully ate ${foodItem.name}.`);
          } catch (err) {
            console.error('[EAT ERROR]', err.message || err);
          }
        }
        break;

      case 'equip':
        const gearKw = (target || '').toLowerCase();
        const gearItem = bot.inventory.items().find(i => i.name.toLowerCase().includes(gearKw));
        if (gearItem) {
          try {
            await bot.equip(gearItem, 'hand');
            await internalThought(`Equipped ${gearItem.name} in main hand.`);
          } catch (err) {
            console.error('[EQUIP ERROR]', err.message || err);
          }
        }
        break;

      case 'chat_only':
        break;
    }
  }

  bot.on('chat', async (username, message) => {
    if (username === bot.username || isProcessing) return;

    isProcessing = true;
    console.log(`[CHAT INCOMING] ${username}: ${message}`);
    pushToHistory('user', username, message);

    const worldContext = buildWorldContext();

    try {
      const result = await analyzeMessage(username, message, worldContext, chatHistory);
      if (result) {
        if (result.type === 'text') {
          bot.chat(`/me ${result.text}`);
          pushToHistory('assistant', 'Alice', result.text);
        } else if (result.type === 'function') {
          const { name, args } = result.action;
          console.log(`[ACTION CALL] Executing ${name} with arguments:`, args);

          if (name === 'interactWithWorld') {
            const { actions, sayInChat } = args;

            if (sayInChat) {
              bot.chat(`/me ${sayInChat}`);
              pushToHistory('assistant', 'Alice', sayInChat);
            }

            if (actions && Array.isArray(actions)) {
              for (const actionObj of actions) {
                await executeSingleAction(actionObj, username);
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('[CHAT ERROR]', err.message || err);
    } finally {
      isProcessing = false;
    }
  });

  bot.on('error', (err) => {
    console.error('[BOT ERROR]', err.message || err);
  });

  bot.on('end', (reason) => {
    console.log(`[BOT DISCONNECTED] Reason: ${reason}. Reconnecting in 10 seconds...`);
    setTimeout(initBot, 10000);
  });
}
