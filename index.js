const http = require('http');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
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

  let mcData = null;

  bot.on('login', () => {
    console.log('[BOT] Successfully logged in to the server.');
  });

  bot.once('spawn', () => {
    console.log('[BOT] Alice spawned in the world.');
    
    // WYMUSZENIE WŁĄCZENIA FIZYKI I KONTROLI RUCHU
    bot.physicsEnabled = true;

    try {
      const version = bot.version || '1.21';
      mcData = require('minecraft-data')(version);
      if (mcData) {
        const defaultMove = new Movements(bot, mcData);
        bot.pathfinder.setMovements(defaultMove);
        console.log('[BOT] Pathfinder movements initialized successfully.');
      }
    } catch (err) {
      console.error('[BOT ERROR] Failed to initialize pathfinder movements:', err.message || err);
    }
  });

  // Wyszukiwanie gracza uwzględniające prefiksy Geysera / Bedrock
  function findTargetEntity(username) {
    const cleanUser = username.toLowerCase().replace(/^\./, '');
    
    for (const name of Object.keys(bot.players)) {
      if (name.toLowerCase().replace(/^\./, '') === cleanUser) {
        if (bot.players[name]?.entity) return bot.players[name].entity;
      }
    }

    return Object.values(bot.entities).find(e => 
      e.type === 'player' && 
      e.username && 
      e.username.toLowerCase().replace(/^\./, '') === cleanUser
    );
  }

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
          bot.chat(`/me Idę na X:${args.x} Y:${args.y} Z:${args.z}`);
          break;

        case 'followPlayer':
          const target = findTargetEntity(args.targetUsername);
          if (target) {
            bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true);
            bot.chat(`/me Podążam za tobą!`);
          } else {
            bot.chat(`/me Nie widzę Cię w pamięci encji.`);
          }
          break;

        case 'stopMovement':
          bot.pathfinder.setGoal(null);
          bot.setControlState('jump', false);
          bot.setControlState('forward', false);
          bot.chat('/me Zatrzymałam się.');
          break;

        case 'digBlock':
          const Vec3 = require('vec3');
          const targetPos = new Vec3(args.x, args.y, args.z);
          const block = bot.blockAt(targetPos);

          if (block && block.name !== 'air') {
            bot.chat(`/me Kopię ${block.name}...`);
            
            // Bezpośrednie wywołanie kopania z pominięciem obietnicy lookAt
            bot.targetDigBlock = block;
            bot.dig(block)
              .then(() => bot.chat('/me Wykopano!'))
              .catch(err => {
                console.error('[DIG ERROR]', err);
                bot.chat('/me Nie udało się wykopać bloku.');
              });
          } else {
            bot.chat("/me Tu nie ma bloku.");
          }
          break;

        case 'findAndDigBlock':
          if (!mcData) {
            bot.chat("/me Brak danych świata.");
            break;
          }
          const targetBlockType = mcData.blocksByName[args.blockName];
          if (!targetBlockType) {
            bot.chat(`/me Nie znam bloku ${args.blockName}.`);
            break;
          }

          const foundBlock = bot.findBlock({
            matching: targetBlockType.id,
            maxDistance: 32
          });

          if (foundBlock) {
            bot.chat(`/me Znalazłam ${args.blockName}, idę tam!`);
            bot.pathfinder.setGoal(new goals.GoalGetToBlock(foundBlock.position.x, foundBlock.position.y, foundBlock.position.z));
            
            const onGoalReached = () => {
              bot.dig(foundBlock)
                .catch(err => console.error('[DIG ERROR]', err))
                .finally(() => bot.off('goal_reached', onGoalReached));
            };
            bot.on('goal_reached', onGoalReached);
          } else {
            bot.chat(`/me Nie widzę bloku ${args.blockName} w pobliżu.`);
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
