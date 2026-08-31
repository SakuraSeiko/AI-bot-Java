const http = require('http');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const toolPlugin = require('mineflayer-tool').plugin;
const Vec3 = require('vec3');
const { initGemini, analyzeMessage } = require('./gemini');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Emillie AI Bot Service is active.\n');
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
    username: 'Emillie',
    version: '26.1'
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
    console.log('[BOT] Emillie spawned in the world.');
    bot.physicsEnabled = true;

    try {
      const version = bot.version || '1.21';
      mcData = require('minecraft-data')(version);
      if (mcData) {
        const defaultMove = new Movements(bot, mcData);
        defaultMove.canDig = true;
        defaultMove.allowParkour = true;
        defaultMove.allowSprinting = true;
        bot.pathfinder.setMovements(defaultMove);
        console.log('[BOT] Pathfinder initialized successfully with full jumping and parkour capabilities.');
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
    return items.map(() => 'dropped_item');
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

  function findValidPlacementSpot() {
    const basePos = bot.entity.position.floored();
    const searchOffsets = [
      new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
      new Vec3(0, 0, 1), new Vec3(0, 0, -1),
      new Vec3(1, 0, 1), new Vec3(-1, 0, -1)
    ];

    for (const off of searchOffsets) {
      const spotPos = basePos.plus(off);
      const groundBlock = bot.blockAt(spotPos.offset(0, -1, 0));
      const targetBlock = bot.blockAt(spotPos);

      if (groundBlock && groundBlock.name !== 'air' && groundBlock.name !== 'water' && targetBlock && targetBlock.name === 'air') {
        return { referenceBlock: groundBlock, faceVector: new Vec3(0, 1, 0), spotPosition: spotPos };
      }
    }
    return null;
  }

  async function internalThought(thoughtMessage) {
    pushToHistory('user', 'System', thoughtMessage);
    const worldContext = buildWorldContext();

    const thoughtResult = await analyzeMessage('System', thoughtMessage, worldContext, chatHistory);
    
    if (thoughtResult && thoughtResult.type === 'function') {
      const { thought, sayInChat } = thoughtResult.action.args;
      if (thought) {
        console.log(`[EMILLIE INTERNAL THOUGHT] ${thought}`);
      }
      if (sayInChat) {
        bot.chat(`/me ${sayInChat}`);
        pushToHistory('assistant', 'Emillie', sayInChat);
      }
    }
  }

  async function executeSingleAction(actionObj, username) {
    const { action, target, count } = actionObj;
    console.log(`[EXECUTE ACTION] Type: ${action}, Target: ${target}, Count: ${count}`);

    try {
      switch (action) {
        case 'follow':
          const playerToFollow = findTargetEntity(username);
          if (playerToFollow) {
            bot.pathfinder.setGoal(new goals.GoalFollow(playerToFollow, 2), true);
            await new Promise(resolve => setTimeout(resolve, 3000));
          } else {
            bot.chat('/me Nie widzę Cię w pobliżu.');
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

            await bot.pathfinder.goto(defaultGoal);
            const freshBlock = bot.blockAt(targetBlock.position);
            if (freshBlock && freshBlock.name !== 'air') {
              if (bot.tool && bot.tool.equipForBlock) {
                await bot.tool.equipForBlock(freshBlock);
              }
              await bot.dig(freshBlock);
              minedCount++;

              await new Promise(r => setTimeout(r, 300));
              const pickupGoal = new goals.GoalBlock(targetBlock.position.x, targetBlock.position.y, targetBlock.position.z);
              await bot.pathfinder.goto(pickupGoal).catch(() => {});
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
            if (dropAmount && dropAmount < itemToDrop.count) {
              await bot.toss(itemToDrop.type, itemToDrop.metadata, dropAmount);
              await internalThought(`Successfully dropped ${dropAmount} of ${itemToDrop.name} on the ground.`);
            } else {
              await bot.tossStack(itemToDrop);
              await internalThought(`Successfully dropped all ${itemToDrop.name} on the ground.`);
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
            const goal = new goals.GoalBlock(
              Math.floor(droppedItem.position.x),
              Math.floor(droppedItem.position.y),
              Math.floor(droppedItem.position.z)
            );
            await bot.pathfinder.goto(goal);
            await new Promise(resolve => setTimeout(resolve, 800));
            await internalThought(`Walked to dropped item and picked it up.`);
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
          } else {
            await internalThought(`Tried to hunt ${target}, but could not find any matching entity nearby.`);
          }
          break;

        case 'craft':
          const recipeKw = (target || '').toLowerCase();
          const craftCount = Number(count) || 1;

          if (mcData) {
            const itemObj = mcData.itemsByName[recipeKw] || mcData.blocksByName[recipeKw];
            const recipes = itemObj ? mcData.recipes[itemObj.id] : null;

            if (recipes && recipes.length > 0) {
              const recipe = recipes[0];
              const craftingTable = bot.findBlock({
                matching: b => b && b.name === 'crafting_table',
                maxDistance: 5
              });

              if (recipe.requiresTable && !craftingTable) {
                await internalThought(`Tried to craft ${recipeKw}, but requires a crafting table nearby.`);
                bot.chat(`/me Potrzebuję stołu rzemieślniczego, żeby wytworzyć ${recipeKw}.`);
                break;
              }

              try {
                await bot.craft(recipe, craftCount, craftingTable);
                await internalThought(`Successfully crafted ${craftCount} of ${recipeKw}.`);
              } catch (craftErr) {
                console.error('[CRAFT ERROR]', craftErr.message || craftErr);
                await internalThought(`Tried to craft ${recipeKw}, but missing required ingredients.`);
                bot.chat(`/me Brakuje mi materiałów w ekwipunku, aby wytworzyć ${recipeKw}.`);
              }
            } else {
              await internalThought(`Could not find a valid crafting recipe for ${recipeKw}.`);
              bot.chat(`/me Nie znam receptury na ${recipeKw}.`);
            }
          }
          break;

        case 'place':
          const placeKw = (target || '').toLowerCase();
          const itemToPlace = bot.inventory.items().find(i => i.name.toLowerCase().includes(placeKw));

          if (itemToPlace) {
            const validSpot = findValidPlacementSpot();
            if (validSpot) {
              await bot.equip(itemToPlace, 'hand');
              const approachGoal = new goals.GoalNear(validSpot.spotPosition.x, validSpot.spotPosition.y, validSpot.spotPosition.z, 2);
              await bot.pathfinder.goto(approachGoal).catch(() => {});

              await bot.placeBlock(validSpot.referenceBlock, validSpot.faceVector);
              await internalThought(`Placed block ${itemToPlace.name} at target ground position.`);
            } else {
              await internalThought(`Tried to place ${target}, but could not find valid nearby ground spot.`);
              bot.chat(`/me Nie widzę w pobliżu odpowiedniego miejsca na postawienie ${target}.`);
            }
          } else {
            await internalThought(`Tried to place ${target}, but do not have it in inventory.`);
            bot.chat(`/me Nie mam przy sobie ${target}, żeby to postawić.`);
          }
          break;

        case 'sleep':
          const bedBlock = bot.findBlock({
            matching: b => b && b.name.includes('bed'),
            maxDistance: 10
          });

          if (bedBlock) {
            const bedGoal = new goals.GoalNear(bedBlock.position.x, bedBlock.position.y, bedBlock.position.z, 1.5);
            await bot.pathfinder.goto(bedGoal).catch(() => {});
            await new Promise(r => setTimeout(r, 400));

            const freshBedBlock = bot.blockAt(bedBlock.position);
            if (freshBedBlock && freshBedBlock.name.includes('bed')) {
              await bot.sleep(freshBedBlock);
              await internalThought(`Successfully went to sleep in bed.`);
            } else {
              await internalThought(`Tried to sleep, but the bed vanished or was broken.`);
              bot.chat(`/me Wygląda na to, że łóżko zniknęło.`);
            }
          } else {
            await internalThought(`Tried to sleep, but could not find a bed nearby.`);
            bot.chat(`/me Nie widzę w pobliżu żadnego łóżka.`);
          }
          break;

        case 'wake':
          if (bot.isSleeping) {
            await bot.wake();
            await internalThought(`Successfully woke up from bed.`);
          } else {
            await internalThought(`Tried to wake up, but was not in bed.`);
          }
          break;

        case 'eat':
          const foodKw = (target || '').toLowerCase();
          const foodItem = bot.inventory.items().find(i => i.name.toLowerCase().includes(foodKw));
          if (foodItem) {
            await bot.equip(foodItem, 'hand');
            await bot.consume();
            await internalThought(`Successfully ate ${foodItem.name}.`);
          }
          break;

        case 'equip':
          const gearKw = (target || '').toLowerCase();
          const gearItem = bot.inventory.items().find(i => i.name.toLowerCase().includes(gearKw));
          if (gearItem) {
            await bot.equip(gearItem, 'hand');
            await internalThought(`Equipped ${gearItem.name} in main hand.`);
          }
          break;

        case 'chat_only':
          break;
      }
    } catch (err) {
      console.error(`[ACTION ERROR - ${action}]`, err.message || err);
      await internalThought(`Failed action ${action}: ${err.message}`);
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
          pushToHistory('assistant', 'Emillie', result.text);
        } else if (result.type === 'function') {
          const { name, args } = result.action;
          console.log(`[ACTION CALL] Executing ${name} with arguments:`, args);

          if (name === 'interactWithWorld') {
            const { thought, actions, sayInChat } = args;

            if (thought) {
              console.log(`[EMILLIE INTERNAL THOUGHT] ${thought}`);
            }

            if (sayInChat) {
              bot.chat(`/me ${sayInChat}`);
              pushToHistory('assistant', 'Emillie', sayInChat);
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
