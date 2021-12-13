const fs = require('fs');
const { NearScanner } = require('@toio/scanner');
const { WebSocket } = require("ws");
const yaml = require('js-yaml');


const ws = new WebSocket("ws://127.0.0.1:8081");
const INSTANCE = yaml.load(fs.readFileSync(process.argv[2], 'utf8'));
const num_agents = INSTANCE["agents"].length;

ws.on('open', () => {
  toioSetup(num_agents).then(cubes => {
    setTimeout(() => {
      msg = JSON.stringify(INSTANCE);
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
  let actions = [];
  let fin_agents_num = 0;

  for (let i = 0; i < num_agents; ++i) {
    let cube = cubes[i];
    cube.on("motor:response", operation_id => {
      action_done = instructions[i][operation_id - 2];
      action_done["suc"].forEach((child) => {
        let j = child[0]-1;
        let id_j = child[1];
        let idx = instructions[j].findIndex(ele => ele["id"] == id_j);
        instructions[j][idx]["pre"] = instructions[j][idx]["pre"].filter(
          ele => !(ele[0]-1 == i && ele[1] == action_done["id"])
        );
        if (instructions[j][idx]["pre"].length == 0) {
          let inst = instructions[j][idx];
          moveTo(cubes[j], [inst["x_to"], inst["y_to"]]);
        }
      });

      // check termination
      if (action_done["suc"].filter(ele => ele[0]-1 == i).length == 0) {
        ++fin_agents_num;
        if (fin_agents_num >= num_agents) {
          process.exit(0);
        }
      }
    });
  }

  for (let i = 0; i < num_agents; ++i) {
    let inst = instructions[i][0];
    moveTo(cubes[i], [inst["x_to"], inst["y_to"]]);
  }
}


// async function execute(cubes, instructions) {

//   function moveOneStep(t) {
//     for (let i = 0; i < num_agents; ++i) moveTo(cubes[i], instructions[t][i]);
//   }

//   let GLOBAL_STEP = 0;
//   let CONFIG = [];
//   for (let i = 0; i < num_agents; ++i) {
//     CONFIG.push(0);
//     cubes[i].on("motor:response", operation_id => {
//       CONFIG[i] = operation_id;
//       if (CONFIG.every(x => x == operation_id)) {
//         GLOBAL_STEP += 1;

//         if (GLOBAL_STEP < instructions.length) {
//           moveOneStep(GLOBAL_STEP);
//         } else {
//           setTimeout(() => {process.exit(0);}, 1000);
//         }
//       }
//     });
//   }
//   moveOneStep(1);
// }

async function toioSetup(num_agents) {
  let cubes = await new NearScanner(num_agents).start();
  cubes.sort(function(a, b) { return (a.id < b.id) ? 1 : -1; });
  for (let i = 0; i < num_agents; ++i) {
    await cubes[i].connect();
    let c = INSTANCE["agents"][i];
    moveTo(cubes[i], [c["x_init"], c["y_init"]]);
  }
  await sleep(1000);
  return cubes;
};

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
