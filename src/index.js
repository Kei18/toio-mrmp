const fs = require('fs');
const { NearScanner } = require('@toio/scanner');
const { WebSocket } = require("ws");
const yaml = require('js-yaml');

let CONFIG = yaml.load(fs.readFileSync(process.argv[2], 'utf8'));
const num_agents = CONFIG["instance"]["agents"].length;
const MAX_SPEED = CONFIG["robots"]["max_speed"];
if (process.argv.length > 3 && process.argv[3] === "reverse") {
  for (let i = 0; i < num_agents; ++i) {
    let tmp_x = CONFIG["instance"]["agents"][i]["x_init"];
    CONFIG["instance"]["agents"][i]["x_init"] = CONFIG["instance"]["agents"][i]["x_goal"];
    CONFIG["instance"]["agents"][i]["x_goal"] = tmp_x;

    let tmp_y = CONFIG["instance"]["agents"][i]["y_init"];
    CONFIG["instance"]["agents"][i]["y_init"] = CONFIG["instance"]["agents"][i]["y_goal"];
    CONFIG["instance"]["agents"][i]["y_goal"] = tmp_y;
  }
}

toioSetup(num_agents).then(cubes => {
  const url = "ws://" + CONFIG["server"]["address"] + ":" + String(CONFIG["server"]["port"]);
  console.log("try to connect", url);
  const ws = new WebSocket(url);
  ws.on('open', () => {
    // request
    msg = JSON.stringify(CONFIG["instance"]);
    console.log("request plan");
    ws.send(msg);

    ws.on("message", (data) => {
      console.log("received instructions");
      cubes.forEach(cube => cube.playPresetSound(1));
      msg = JSON.parse(data);
      console.log("%s", data);
      if (msg["status"] === "success") {
        console.log("planning: success");
        execute(cubes, msg["instructions"]);
      } else {
        console.log("planning: failure");
        process.exit(0);
      }
    });
  });
});

function moveTo(cube, inst) {
  cube.moveTo([{x: inst[0], y: inst[1] }], {maxSpeed: MAX_SPEED, moveType: 2, speedType: 3});
}

async function execute(cubes, instructions) {
  let actions = [];
  let fin_agents_num = 0;

  for (let i = 0; i < num_agents; ++i) {
    let cube = cubes[i];
    cube.on("motor:response", operation_id => {
      action_done = instructions[i][operation_id - 2];
      console.log(i + 1, action_done["id"]);
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
        cube.playPresetSound(2);
        if (fin_agents_num >= num_agents) {
          setTimeout(() => {process.exit(0);}, 500);
        }
      }
    });
  }

  // initiate
  for (let i = 0; i < num_agents; ++i) {
    let inst = instructions[i][0];
    if (inst["pre"].length == 0) moveTo(cubes[i], [inst["x_to"], inst["y_to"]]);
  }
}

async function toioSetup(num_agents) {
  let cubes = await new NearScanner(num_agents).start();
  cubes.sort(function(a, b) { return (a.id < b.id) ? 1 : -1; });
  let setup_cube_num = 0;
  for (let i = 0; i < num_agents; ++i) {
    let cube = await cubes[i].connect();
    let c = CONFIG["instance"]["agents"][i];
    moveTo(cube, [c["x_init"], c["y_init"]]);
    cube.on("motor:response", (data) => { ++setup_cube_num; });
  }
  while (setup_cube_num < num_agents) await sleep(500);
  cubes.forEach((cube) => { cube.off("motor:response", (e) => {}); });
  return cubes;
};

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
