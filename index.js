const http = require('http');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const toolPlugin = require('mineflayer-tool').plugin;
const { Vec3 } = require('vec3');
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
  const MAX_HISTORY = 100; // Zwiększono bufor pamięci do 100 wiadomości

  function pushToHistory(role, sender, text) {
    chatHistory.push({ role, sender, text });
    if (chatHistory.length > MAX_HISTORY) {
      chatHistory.shift();
    }
  }

  bot.on('login', () => {
    console.log('[BOT] Successfully logged in to the server.');

    if (bot._client) {
      bot._client.on('error', (err) => {
        if (err.name === 'PartialReadError') {
          console.warn('[PROTOCOL WARN] Handled PartialReadError in packet parsing (SlotComponent).');
          return;
        }
        console.error('[CLIENT ERROR]', err.message || err);
      });
    }
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

  // Udoskonalony skaner: rozróżnia pnie drzew, liście oraz pobliskie bloki
  function getNearbyBlockNames() {
    if (!bot.entity) return [];
    const blocks = bot.findBlocks({
      matching: (b) => b && b.name !== 'air' && b.name !== 'cave_air',
      maxDistance: 12,
      count: 40
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
    return items.map(i => 'dropped_item');
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
          await new Promise(resolve => setTimeout(resolve, 1500));
        } else {
          bot.chat('/me Nie widzę Cię w pobliżu.');
        }
        break;

      case 'stop':
        bot.pathfinder.setGoal(null);
        break;

      case 'mine':
        const blockKw = (target || '').toLowerCase();
        const targetCount = Number(count) || 1;
        let minedCount = 0;

        for (let i = 0; i < targetCount; i++) {
          const targetBlock = bot.findBlock({
            matching: (b) => b && b.name !== 'air' && b.name.toLowerCase().includes(blockKw),
            maxDistance: 32
          });

          if (!targetBlock) break;

          console.log(`[MINING] Targeting block ${targetBlock.name} at position ${targetBlock.position}`);
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

              await new Promise(r => setTimeout(r, 200));
              const pickupGoal = new goals.GoalBlock(targetBlock.position.x, targetBlock.position.y, targetBlock.position.z);
              await bot.pathfinder.goto(pickupGoal).catch(() => {});
            }
          } catch (err) {
            console.error('[MINE ERROR]', err.message || err);
            break;
          }
        }

        if (minedCount === 0) {
          await internalThought(`Próbowałam wykopać ${target}, ale nie znalazłam takiego bloku w pobliżu.`);
        } else if (minedCount < targetCount) {
          await internalThought(`Zakończyłam kopanie. Wykopałam ${minedCount} z requested ${targetCount} bloków ${target}.`);
        } else {
          await internalThought(`Pomyślnie wykopano wszystkie ${targetCount} bloków ${target}.`);
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
              await internalThought(`Wyrzuciłam ${dropAmount} szt. ${itemToDrop.name} na ziemię.`);
            } else {
              await bot.tossStack(itemToDrop);
              await internalThought(`Wyrzuciłam cały stos ${itemToDrop.name} na ziemię.`);
            }
          } catch (err) {
            console.error('[TOSS ERROR]', err.message || err);
          }
        } else {
          await internalThought(`Chciałam wyrzucić ${target}, ale nie mam tego w ekwipunku.`);
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
            await new Promise(resolve => setTimeout(resolve, 500));
            await internalThought(`Podniosłam leżące przedmioty z ziemi.`);
          } catch (err) {
            console.error('[PICKUP ERROR]', err.message || err);
          }
        } else {
          await internalThought(`Chciałam podnieść przedmioty, ale nic nie leży w pobliżu.`);
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
              await new Promise(r => setTimeout(r, 600));
            }
            bot.pathfinder.setGoal(null);
            await internalThought(`Zaatakowałam ${target}.`);
          } catch (err) {
            console.error('[ATTACK ERROR]', err.message || err);
          }
        } else {
          await internalThought(`Chciałam zaatakować ${target}, ale nie ma go w pobliżu.`);
        }
        break;

      case 'craft':
        const recipeKw = (target || '').toLowerCase();
        const craftCount = Number(count) || 1;

        if (mcData) {
          const itemInfo = mcData.itemsByName[recipeKw] || mcData.blocksByName[recipeKw];

          if (itemInfo) {
            let craftingTable = bot.findBlock({
              matching: b => b && b.name === 'crafting_table',
              maxDistance: 6
            });

            const recipes = bot.recipesFor(itemInfo.id, null, 1, craftingTable);

            if (recipes.length > 0) {
              try {
                if (recipes[0].requiresTable) {
                  if (craftingTable) {
                    await bot.lookAt(craftingTable.position);
                  } else {
                    await internalThought(`Receptura na ${recipeKw} wymaga stołu rzemieślniczego, ale go tu nie widzę.`);
                    break;
                  }
                }

                await bot.craft(recipes[0], craftCount, craftingTable);
                await internalThought(`Pomyślnie wytworzono ${craftCount}x ${recipeKw}.`);
              } catch (err) {
                console.error('[CRAFT ERROR]', err.message || err);
                await internalThought(`Nie udało się wytworzyć ${recipeKw}: opóźnienie interfejsu lub brak miejsca.`);
              }
            } else {
              await internalThought(`Brak receptury lub odpowiednich składników do wytworzenia ${recipeKw}.`);
            }
          } else {
            await internalThought(`Nie znalazłam ${recipeKw} w bazie danych przedmiotów.`);
          }
        }
        break;

      case 'place':
        const placeKw = (target || '').toLowerCase();
        const itemToPlace = bot.inventory.items().find(i => i.name.toLowerCase().includes(placeKw));

        if (itemToPlace) {
          try {
            await bot.equip(itemToPlace, 'hand');
            
            // Szukanie najbliższej solidnej podstawy (Anchor block) pod nogami lub z boku
            const basePos = bot.entity.position.floored().offset(0, -1, 0);
            const refBlock = bot.blockAt(basePos) || bot.blockAt(bot.entity.position.floored().offset(1, -1, 0));

            if (refBlock && refBlock.name !== 'air') {
              await bot.placeBlock(refBlock, new Vec3(0, 1, 0)).catch(err => {
                console.warn('[PLACE WARN] Direct place issue:', err.message);
              });
              await internalThought(`Postawiono blok ${itemToPlace.name}.`);
            } else {
              await internalThought(`Brak stabilnej powierzchni do postawienia bloku ${placeKw}.`);
            }
          } catch (err) {
            console.error('[PLACE ERROR]', err.message || err);
            await internalThought(`Nie udała się próba postawienia ${placeKw}.`);
          }
        } else {
          await internalThought(`Chciałam postawić ${target}, ale nie mam tego w ekwipunku.`);
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
            await internalThought(`Położyłam się do łóżka.`);
          } catch (err) {
            console.error('[SLEEP ERROR]', err.message || err);
            await internalThought(`Próba snu nie powiodła się: ${err.message}`);
          }
        } else {
          await internalThought(`Nie widzę w pobliżu żadnego łóżka.`);
        }
        break;

      case 'eat':
        const foodKw = (target || '').toLowerCase();
        const foodItem = bot.inventory.items().find(i => i.name.toLowerCase().includes(foodKw));
        if (foodItem) {
          try {
            await bot.equip(foodItem, 'hand');
            await bot.consume();
            await internalThought(`Zjadłam ${foodItem.name}.`);
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
            await internalThought(`Wyposażono ${gearItem.name} w dłoni.`);
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
