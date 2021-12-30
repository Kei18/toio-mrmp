// server
const { Server } = require("socket.io");
const { ArgumentParser } = require("argparse");
const { WebSocket } = require("ws");
const { Mutex } = require('async-mutex');
const { sleep, get_config, get_num_agents, get_consistent_commit } = require("./utils");

const parser = new ArgumentParser({});
parser.add_argument('-i', '--instance', {required: true});
parser.add_argument('-v', '--max_speed', {default: 80});
parser.add_argument('-p', '--port', {default: 3000});
parser.add_argument('-k', '--num_agents', {default: 1000});
parser.add_argument('-w', '--wait_time', {default: 2000});
parser.add_argument('-r', '--reversed', {action: "store_true"});
parser.add_argument('-s', '--use_current_starts', {action: "store_true"});
parser.add_argument('-o', '--commit_offset', {default: 0});
const args = parser.parse_args();

// start server
const io = new Server(args.port);

let NETWORK = [];    // agent -> { socket, offset, cube_id }

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

// ------------------------------------------------------------

const setup_toio = async (CONFIG) => {
  const sockets = await io.fetchSockets();
  console.log("start setup, %d sockets", sockets.length);

  const N = CONFIG["instance"]["agents"].length;

  // start action
  let setup_cube_num = 0;
  let init_operation_id_arr = [...Array(N)].fill(0);

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
  for (let i = 0; i < N; ++i) {
    playSound(i, 1);
    let c = CONFIG.instance.agents[i];
    moveTo(i, c.x_init, c.y_init);
  }

  // wait for initialization of robots
  while (setup_cube_num < N) await sleep(500);
  for (const socket of sockets) socket.removeAllListeners("message");

  // try to connect planning module
  const url = `ws://${CONFIG.server.address}:${CONFIG.server.port}`;
  console.log("try to connect", url);
  const ws = new WebSocket(url);

  // request
  ws.on("open", () => {
    console.log("request plan");
    ws.send(JSON.stringify(CONFIG.instance));
  });

  ws.once("error", (err) => { console.log(err); process.exit(0); });

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
  const N = instructions.length;
  let plan_id = 1;  // for Julia
  let fin_agents_num = 0;  // to judge termination
  let progress_indexes = Array(N).fill(-1);   // finish actions
  let acting_agents = Array(N).fill(false);   // acting -> true
  let committed_indexes = Array(N).fill(-1);  // committed indexes
  const commit_offset = Number(args.commit_offset);

  const mutex = new Mutex();  // mutex

  const act = async (i, idx) => {
    let action = instructions[i][idx];
    update_commit(i, idx);
    console.log(`agent ${(i + 1).toString().padStart(2)}   `
                + `starts action ${idx.toString().padStart(2)}:${(action.id).padStart(10)}`);
    acting_agents[i] = true;
    moveTo(i, action.x_to, action.y_to);
  };

  const update_commit = (i, idx) => {
    // still consistent
    if (committed_indexes[i] >= idx) return;
    // case: inconsistent -> update
    committed_indexes[i] = idx;
    committed_indexes = get_consistent_commit(instructions, committed_indexes, commit_offset);
    console.log("new commit:".padStart(60), committed_indexes);
    let msg = {"type": "commit", "plan_id": plan_id, "committed_indexes": committed_indexes};
    ws.send(JSON.stringify(msg));
  };

  // re-planning
  ws.on("message", (data) => {
    const msg = JSON.parse(data);
    const commited_indexes_str = msg.committed_indexes.map(e => e-1);
    console.log("receive re-plannig:".padStart(60), commited_indexes_str);

    // lock
    mutex.runExclusive(() => {
      // check consistency
      const invalid = committed_indexes.some((k, i) => k != msg.committed_indexes[i]-1);
      // update plan_id
      plan_id = invalid ? plan_id : msg.plan_id;
      // return message to planner
      let return_msg = {"type": "commit", "plan_id": plan_id, "committed_indexes": committed_indexes};
      ws.send(JSON.stringify(return_msg));
      if (invalid) {
        console.log("reject plan:".padStart(60), commited_indexes_str);
        return;
      }
      // update plan
      for (let i = 0; i < N; ++i) {
        // cutoff old actions
        instructions[i] = instructions[i].filter((e, k) => k <= committed_indexes[i]);
      }
      for (let i = 0; i < N; ++i) {
        // modify relationship
        l = committed_indexes[i];
        if (l >= 0 && msg.instructions[i].length > 0) {
          for (let t = 0; t <= l; ++t) {
            instructions[i][t].suc = instructions[i][t].suc.filter(e => {
              return instructions[e[0]-1].findIndex(ele => ele["id"] == e[1]) != -1;
            });
          }
        }
      }
      for (let i = 0; i < N; ++i) {
        // append new actions
        if (msg.instructions[i].length > 0) {
          l = committed_indexes[i];
          instructions[i] = instructions[i].concat(msg.instructions[i]);
          if (progress_indexes[i] != l) {
            instructions[i][l].suc.push([i+1, msg.instructions[i][0].id]);
            instructions[i][l+1].pre.push([i+1, instructions[i][l].id]);
          }
        }
      }
      console.log("update plan:".padStart(60), commited_indexes_str);
    }).then(() => {
      for (let i = 0; i < N; ++i) {
        // additional trigger
        if (acting_agents[i]) continue;
        k = progress_indexes[i] + 1;
        if (k < instructions[i].length && instructions[i][k].pre.length == 0) act(i, k);
      }
    });
  });

  ws.on("error", (err) => {console.log(err);});

  const check_termination = async (i, action_done) => {
    if (action_done.suc.filter(ele => ele[0]-1 == i).length != 0) return;
    console.log(`agent ${(i + 1).toString().padStart(2)} finishes all actions`);
    ++fin_agents_num;
    playSound(i, 6);
    if (fin_agents_num >= N) {
      await sleep(500);
      for (let i = 0; i < N; ++i) playSound(i, 7);
      process.exit(0);
    }
  };

  for (const socket of sockets) {
    // agent finishes one action
    socket.on("message", data => {
      let msg = JSON.parse(data);
      if (msg.type != "report") return;

      // get corresponding agent
      let i = get_agent_from_socket(socket.id, msg.body.agent);
      // update progress index
      acting_agents[i] = false;
      progress_indexes[i] = msg.body.operation_id - init_operation_id_arr[i] - 1;

      // lock
      mutex.runExclusive(() => {
        // get just finished action
        let action_done = instructions[i][progress_indexes[i]];
        console.log(`agent ${(i + 1).toString().padStart(2)} finishes action `
                    + `${progress_indexes[i].toString().padStart(2)}:${(action_done.id).padStart(10)}`);

        // update conditions
        for (const child of action_done["suc"]) {
          // successor agent
          let j = child[0]-1;
          // index of successor action
          let idx = instructions[j].findIndex(ele => ele["id"] == child[1]);
          // not found -> error
          if (idx == -1) {
            console.log("fail to find agent-%d's action %s", j+1, child[1]);
            process.exit(0);
          }
          // found -> remove corresponding predecessors
          instructions[j][idx].pre = instructions[j][idx].pre.filter(
            ele => !(ele[0]-1 == i && ele[1] == action_done.id)
          );
          // trigger other actions
          if (instructions[j][idx].pre.length == 0) act(j, idx);
        }
        return [i, action_done];
      }).then((res) => {
        check_termination(res[0], res[1]);
      });
    });
  }

  // initiate
  for (let i = 0; i < N; ++i) {
    if (instructions[i][0].pre.length == 0) {
      playSound(i, 3);
      act(i, 0);
    }
  }
};

// ------------------------------------------------------------
// start server
let init_locations = [];
io.on("connection", (socket) => {
  console.log("connected to one edge_controller %s", socket.id);
  const N = get_num_agents(args);

  let called = false;
  let setup_instance = async () => {
    if (called) return;
    called = true;
    await sleep(args.wait_time);  // wait for a while

    // sort network
    NETWORK.sort((a, b) => { return (a.cube_id < b.cube_id) ? 1 : -1; });
    init_locations.sort((a, b) => { return (a.cube_id < b.cube_id) ? 1 : -1; });

    // read problem instance
    const CONFIG = get_config(args, init_locations);
    setup_toio(CONFIG);
  };

  socket.once("message", data => {
    msg = JSON.parse(data);
    if (msg.type != "init") return;
    for (let i = 0; i < msg.body.length; ++i) {
      NETWORK.push({socket: socket, offset: i, cube_id: msg.body[i].id});
      init_locations.push({cube_id: msg.body[i].id, x: msg.body[i].x, y: msg.body[i].y});
    }
    if (NETWORK.length >= N) setup_instance();
  });
});
