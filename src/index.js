const fs = require('fs');
const { NearScanner } = require('@toio/scanner');
const { WebSocket } = require("ws");


const ws = new WebSocket("ws://127.0.0.1:8081");
let GOALS = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let num_agents = GOALS["agents"].length;

ws.on('open', () => {
  toioSetup(num_agents).then(cubes => {
    setTimeout(() => {
      msg = JSON.stringify(GOALS);
      console.log("request plan: %s", msg);
      ws.send(msg);
    }, 2000);

    ws.on("message", (data) => {
      console.log('received: %s', data);
      execute(cubes, JSON.parse(data));
    });
  });
});

function moveTo(cube, inst) {
  cube.moveTo([{x: inst[0], y: inst[1] }], {maxSpeed: 80, moveType: 2});
}

async function execute(cubes, instructions) {

  function moveOneStep(t) {
    for (let i = 0; i < num_agents; ++i) moveTo(cubes[i], instructions[t][i]);
  }

  let GLOBAL_STEP = 0;
  let CONFIG = [];
  for (let i = 0; i < num_agents; ++i) {
    CONFIG.push(0);
    cubes[i].on("motor:response", operation_id => {
      CONFIG[i] = operation_id;
      if (CONFIG.every(x => x == operation_id)) {
        GLOBAL_STEP += 1;

        if (GLOBAL_STEP < instructions.length) {
          moveOneStep(GLOBAL_STEP);
        } else {
          setTimeout(() => {process.exit(0);}, 1000);
        }
      }
    });
  }
  moveOneStep(0);
}

async function toioSetup(num_agents) {
  let cubes = await new NearScanner(num_agents).start();
  cubes.sort(function(a, b) { return (a.id < b.id) ? 1 : -1; });
  for (let i = 0; i < num_agents; ++i) await cubes[i].connect();
  await sleep(1000);
  return cubes;
};

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
