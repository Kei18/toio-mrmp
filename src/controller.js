// server
const { Server } = require("socket.io");
const { ArgumentParser } = require("argparse");
const { WebSocket } = require("ws");
const { sleep, get_config, get_consistent_cut } = require("./utils");

const parser = new ArgumentParser({});
parser.add_argument('-i', '--instance', {required: true});
parser.add_argument('-v', '--max_speed', {help: "max_speed", default: 80});
parser.add_argument('-p', '--port', {default: 3000});
parser.add_argument('-k', '--num_agents', {default: 1000});
parser.add_argument('-w', '--wait_time', {default: 2000});
parser.add_argument('-r', '--reversed', {default: false});
const args = parser.parse_args();

// read problem instance
const CONFIG = get_config(args);
const num_agents = CONFIG["instance"]["agents"].length;

// start server
const io = new Server(args.port);

let NETWORK = [];    // agent -> { socket, offset, cube_id }
let setup_done = false;

// ------------------------------------------------------------
// utilities

const get_agent_from_socket = (socket_id, agent_index) => {
  for (let i = 0; i < NETWORK.length; ++i) {
    if (NETWORK[i].socket.id == socket_id && NETWORK[i].offset == agent_index) {
      return i;
    }
  }
  return nothing;
};
const get_socketinfo_from_agent = (i) => NETWORK[i];

const moveTo = (i, x, y) => {
  let ele = get_socketinfo_from_agent(i);
  ele.socket.send(JSON.stringify({
    agent: ele.offset, operation: "moveTo", params: [
      [{x: x, y: y}],
      {maxSpeed: args.max_speed, moveType: 2, speedType: 3}
    ]
  }));
};

const playSound = (i, sound_type=0) => {
  let ele = get_socketinfo_from_agent(i);
  ele.socket.send(JSON.stringify({
    agent: ele.offset, operation: "playPresetSound", params: [sound_type]
  }));
};

const finish = async () => {
  await sleep(500);
  for (let i = 0; i < num_agents; ++i) playSound(i, 7);
  process.exit(0);
};

// ------------------------------------------------------------

const setup = async () => {
  if (setup_done) return;
  setup_done = true;

  const sockets = await io.fetchSockets();
  NETWORK.sort((a, b) => { return (a.cube_id < b.cube_id) ? 1 : -1; });
  console.log("start setup, %d sockets", sockets.length);

  // start action
  let setup_cube_num = 0;
  let init_operation_id_arr = [...Array(num_agents)].fill(0);

  // add listener
  for (const socket of sockets) {
    socket.on("message", data => {
      let msg = JSON.parse(data);
      if (msg.type != "report") return;
      let i = get_agent_from_socket(socket.id, msg.body.agent);
      init_operation_id_arr[i] = msg.body.operation_id;
      ++setup_cube_num;
    });
  };

  // send move action
  for (let i = 0; i < num_agents; ++i) {
    playSound(i, 1);
    let c = CONFIG.instance.agents[i];
    moveTo(i, c.x_init, c.y_init);
  }

  // wait for initialization of robots
  while (setup_cube_num < num_agents) await sleep(500);
  for (const socket of sockets) socket.removeAllListeners("message");

  // try to connect planning module
  const url = `ws://${CONFIG.server.address}:${CONFIG.server.port}`;
  console.log("try to connect", url);
  const ws = new WebSocket(url);

  // request
  ws.on('open', () => {
    console.log("request plan");
    ws.send(JSON.stringify(CONFIG.instance));
  });

  // receive message
  ws.once("message", (data) => {
    console.log("received instructions");
    const msg = JSON.parse(data);
    if (msg.status === "success") {
      console.log("planning: success");
      execute(msg.instructions, sockets, init_operation_id_arr, ws);
    } else {
      console.log("planning: failure");
      process.exit(0);
    }
  });
};

const execute = async (instructions, sockets, init_operation_id_arr, ws) => {
  let actions = [];
  let fin_agents_num = 0;

  let progress_indexes = [];   // finish
  let committed_indexes = [];  // cannot change
  for (let i = 0; i < num_agents; ++i) {
    committed_indexes.push(-1);
    progress_indexes.push(-1);
  }

  // re-planning
  ws.on("message", (data) => {
    const msg = JSON.parse(data);

    // check consistency
    for (let i = 0; i < num_agents; ++i) {
      if (committed_indexes[i] > msg.committed_indexes[i] - 1) {
        console.log("receive re-planning, commit: %s, rejected", msg.committed_indexes.map(e => e-1));
        return;
      }
    }
    console.log("receive re-planning, commit: %s, accepted", msg.committed_indexes.map(e => e-1));

    for (let i = 0; i < num_agents; ++i) {
      let last_index = msg.committed_indexes[i] - 1;  // Julia -> node.js
      instructions[i] = instructions[i].filter((e, k) => k <= last_index);
      if (msg.instructions[i].length == 0) continue;
      for (let action of msg.instructions[i]) instructions[i].push(action);
      if (last_index >= 0) {
        instructions[i][last_index].suc = [[i+1, msg.instructions[i][0].id]];
        instructions[i][last_index+1].pre.push([i+1, instructions[i][last_index].id]);
      }

      // additional trigger
      if (progress_indexes[i] == last_index) {
        committed_indexes[i] = progress_indexes[i] + 1;
        let inst = instructions[i][committed_indexes[i]];
        let msg = { "type": "commit", "committed_indexes": committed_indexes };
        ws.send(JSON.stringify(msg));
        moveTo(i, inst.x_to, inst.y_to);
        // console.log(`\t\t\t\t\t(agent ${(i + 1).toString().padStart(2)}, action ${(inst.id).padStart(10)}) is triggered`);
      }
    }
  });

  for (const socket of sockets) {
    socket.on("message", data => {
      let msg = JSON.parse(data);
      if (msg.type != "report") return;

      // get current action
      let i = get_agent_from_socket(socket.id, msg.body.agent);
      let action_done = instructions[i][msg.body.operation_id - init_operation_id_arr[i] - 1];
      progress_indexes[i] = instructions[i].findIndex(ele => ele["id"] == action_done.id);

      // update conditions
      console.log(`agent ${(i + 1).toString().padStart(2)} finishes action ${(action_done.id).padStart(10)}`);
      for (const child of action_done["suc"]) {
        let j = child[0]-1;  // successor agent
        let id_j = child[1];  // successor action id
        let idx = instructions[j].findIndex(ele => ele["id"] == id_j);  // index
        if (idx == -1) continue;

        // found
        instructions[j][idx]["pre"] = instructions[j][idx]["pre"].filter(
          ele => !(ele[0]-1 == i && ele[1] == action_done["id"])
        );
        // trigger other actions
        if (instructions[j][idx]["pre"].length == 0) {
          let inst = instructions[j][idx];
          // console.log(`\t\t\t\t\t(agent ${(j + 1).toString().padStart(2)}, action ${(id_j).padStart(10)}) is triggered`);

          // update committed indexes
          committed_indexes[j] = idx;
          let msg = { "type": "commit", "committed_indexes": committed_indexes };
          ws.send(JSON.stringify(msg));
          moveTo(j, inst.x_to, inst.y_to);
          console.log("commit:", committed_indexes);
        }
      }

      // check termination
      if (action_done["suc"].filter(ele => ele[0]-1 == i).length == 0) {
        ++fin_agents_num;
        playSound(i, 6);
        // console.log(`agent ${(i + 1).toString().padStart(2)} finishes all actions`);
        if (fin_agents_num >= num_agents) finish();
      }
    });
  }

  // initiate
  for (let i = 0; i < num_agents; ++i) {
    let inst = instructions[i][0];
    if (inst["pre"].length != 0) continue;
    playSound(i, 3);
    moveTo(i, inst.x_to, inst.y_to);
    committed_indexes[i] = 0;
  }
};

// ------------------------------------------------------------
// start server
io.on("connection", (socket) => {
  console.log("connected to one edge_controller %s", socket.id);
  socket.once("message", data => {
    msg = JSON.parse(data);
    if (msg.type != "init") return;
    for (let i = 0; i < msg.body.length; ++i) {
      NETWORK.push({socket: socket, offset: i, cube_id: msg.body[i].id});
    }
    if (NETWORK.length >= num_agents) setTimeout(setup, args.wait_time);
  });
});
