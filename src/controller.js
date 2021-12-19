// server
const { Server } = require("socket.io");
const { ArgumentParser } = require("argparse");
const { WebSocket } = require("ws");
const fs = require('fs');
const yaml = require('js-yaml');
const { sleep } = require("./utils");

const parser = new ArgumentParser({});
parser.add_argument('-i', '--instance', {required: true});
parser.add_argument('-v', '--max_speed', {help: "max_speed", default: 80});
parser.add_argument('-p', '--port', {default: 3000});
const args = parser.parse_args();

// read problem instance
const CONFIG = yaml.load(fs.readFileSync(args.instance, 'utf8'));
const num_agents = CONFIG["instance"]["agents"].length;

// start server
const io = new Server(args.port);

let NETWORK = [];  // agent -> socket
let SOCKETS = [];
let init_operation_id_arr = [];
for (let i = 0; i < num_agents; ++i) init_operation_id_arr.push(0);

function get_agent_from_socket(socket_id, agent_index) {
  for (let i = 0; i < NETWORK.length; ++i) {
    if (NETWORK[i].socket.id == socket_id && NETWORK[i].offset == agent_index) {
      return i;
    }
  }
  return nothing;
}

function get_socketinfo_from_agent(i) {
  return NETWORK[i];
}

io.on("connection", (socket) => {
  console.log("connected to one edge_controller %s", socket.id);
  SOCKETS.push(socket);

  socket.once("message", data => {
    msg = JSON.parse(data);
    if (msg.type != "init") return;
    for (let i = 0; i < msg.body.length; ++i) {
      NETWORK.push({socket: socket, offset: i, cube_id: msg.body[i].id});
      if (NETWORK.length >= num_agents) {
        setup();
        return;
      }
    }
  });

  socket.on("disconnect", () => {
    console.log("disconnected from one edge_controller");
  });
});

async function setup() {
  console.log("start setup");
  NETWORK.sort((a, b) => { return (a.cube_id < b.cube_id) ? 1 : -1; });

  // start action
  let setup_cube_num = 0;

  // add listener
  SOCKETS.forEach(socket => {
    socket.on("message", data => {
      let msg = JSON.parse(data);
      if (msg.type != "report") return;
      let i = get_agent_from_socket(socket.id, msg.body.agent);
      init_operation_id_arr[i] = msg.body.operation_id;
      ++setup_cube_num;
    });
  });

  // send move action
  for (let i = 0; i < num_agents; ++i) {
    let ele = get_socketinfo_from_agent(i);
    ele.socket.send(JSON.stringify({
      agent: ele.offset, operation: "playPresetSound", params: [1]
    }));
    let c = CONFIG.instance.agents[i];
    ele.socket.send(JSON.stringify({
        agent: ele.offset, operation: "moveTo", params: [
          [{x: c.x_init, y: c.y_init}],
          {maxSpeed: args.max_speed, moveType: 2, speedType: 3}
        ]
    }));
  }

  // wait for initialization of robots
  while (setup_cube_num < num_agents) await sleep(500);
  SOCKETS.forEach(socket => { socket.removeAllListeners("message"); });

  // try to connect planning module
  const url = `ws://${CONFIG.server.address}:${CONFIG.server.port}`;
  console.log("try to connect", url);
  const ws = new WebSocket(url);

  // request
  ws.on('open', () => {
    console.log("request plan");
    ws.send(JSON.stringify(CONFIG.instance));

    ws.on("message", (data) => {
      console.log("received instructions");
      let msg = JSON.parse(data);
      if (msg.status === "success") {
        console.log("planning: success");
        execute(msg.instructions);
      } else {
        console.log("planning: failure");
        process.exit(0);
      }
    });
  });
}

async function execute(instructions) {
  let actions = [];
  let fin_agents_num = 0;

  SOCKETS.forEach(socket => {
    socket.on("message", data => {
      let msg = JSON.parse(data);
      if (msg.type != "report") return;
      let i = get_agent_from_socket(socket.id, msg.body.agent);
      action_done = instructions[i][msg.body.operation_id - init_operation_id_arr[i] - 1];

      // trigger other actions
      action_done["suc"].forEach((child) => {
        let j = child[0]-1;
        let id_j = child[1];
        let idx = instructions[j].findIndex(ele => ele["id"] == id_j);
        instructions[j][idx]["pre"] = instructions[j][idx]["pre"].filter(
          ele => !(ele[0]-1 == i && ele[1] == action_done["id"])
        );
        if (instructions[j][idx]["pre"].length == 0) {
          let inst = instructions[j][idx];
          console.log(
            `agent ${(i + 1).toString().padStart(2)} finishes `
              + `action ${(action_done.id).padStart(10)} `
              + `then triggers action ${(id_j).padStart(10)} of `
              + `agent ${(j + 1).toString().padStart(2)}`
          );
          ele = get_socketinfo_from_agent(j);
          ele.socket.send(JSON.stringify({
            agent: ele.offset, operation: "moveTo", params: [
              [{x: inst.x_to, y: inst.y_to}],
              {maxSpeed: args.max_speed, moveType: 2, speedType: 3}
            ]
          }));
        }
      });

      // check termination
      if (action_done["suc"].filter(ele => ele[0]-1 == i).length == 0) {
        ++fin_agents_num;
        socket.send(JSON.stringify({
          agent: msg.body.agent, operation: "playPresetSound", params: [6]
        }));
        if (fin_agents_num >= num_agents) finish();
      }
    });
  });

  // initiate
  for (let i = 0; i < num_agents; ++i) {
    let inst = instructions[i][0];
    if (inst["pre"].length != 0) continue;
    let ele = get_socketinfo_from_agent(i);
    ele.socket.send(JSON.stringify({
      agent: ele.offset, operation: "playPresetSound", params: [3]
    }));
    ele.socket.send(JSON.stringify({
      agent: ele.offset, operation: "moveTo", params: [
          [{x: inst.x_to, y: inst.y_to}],
          {maxSpeed: args.max_speed, moveType: 2, speedType: 3}
        ]
    }));
  }
}

async function finish() {
  await sleep(500);

  for (let i = 0; i < num_agents; ++i) {
    let ele = get_socketinfo_from_agent(i);
    ele.socket.send(JSON.stringify({
      agent: ele.offset, operation: "playPresetSound", params: [7]
    }));
  }

  process.exit(0);
}
