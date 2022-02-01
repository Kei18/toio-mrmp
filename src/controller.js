/*
 * controller
 */

const { Server } = require("socket.io");
const { ArgumentParser } = require("argparse");
const { WebSocket } = require("ws");
const { Mutex } = require('async-mutex');
const { performance } = require('perf_hooks');
const {
  sleep,
  isempty,
  get_config,
  get_num_agents,
  get_consistent_commit,
  get_agent_from_socket,
  moveTo,
  playSound,
  turnOnLight,
  turnOffLight,
  getLogger
} = require("./utils");

const logger = getLogger();

// execution of instructions
const execute = async (instructions, sockets, init_operation_id_arr, ws, NETWORK, speed) => {
  const N = instructions.length;

  // performance measurement
  const time_start = performance.now();
  let time_for_costs = Array(N).fill(0);
  let fin_agents_num = 0;  // to judge termination
  let progress_indexes = Array(N).fill(-1);   // finish actions

  const act = async (i, idx) => {
    let action = instructions[i][idx];
    logger.info(`agent ${(i + 1).toString().padStart(2)}   `
                + `starts action ${idx.toString().padStart(2)}:${(action.id).padStart(10)}`);
    moveTo(NETWORK, i, action.x_to, action.y_to, speed);
  };

  const check_termination = async (i, action_done) => {
    if (!isempty(action_done.suc.filter(ele => ele[0]-1 == i))) return;
    time_for_costs[i] = performance.now();
    logger.info(`agent ${(i + 1).toString().padStart(2)} finishes all actions`);
    ++fin_agents_num;
    playSound(NETWORK, i, 6);
    if (fin_agents_num < N) return;

    // finish all moves
    for (let i = 0; i < N; ++i) {
      turnOffLight(NETWORK, i);
      playSound(NETWORK, i, 7);
    }
    await sleep(500);
    let sum_of_costs = time_for_costs.reduce((acc, val) => acc + val - time_start, 0);
    let makespan = time_for_costs.reduce((acc, val) => Math.max(acc, val - time_start), 0);
    logger.info("sum_of_costs (ms): %f", sum_of_costs);
    logger.info("    makespan (ms): %f", makespan);
    process.exit(0);
  };

  for (const socket of sockets) {
    // agent finishes one action
    socket.on("message", data => {
      let msg = JSON.parse(data);
      if (msg.type != "report") return;

      // get corresponding agent
      let i = get_agent_from_socket(socket.id, msg.body.agent, NETWORK);
      // update progress index
      progress_indexes[i] = msg.body.operation_id - init_operation_id_arr[i] - 1;

      // get just finished action
      let action_done = instructions[i][progress_indexes[i]];
      logger.info(`agent ${(i + 1).toString().padStart(2)} finishes action `
                  + `${progress_indexes[i].toString().padStart(2)}:${(action_done.id).padStart(10)}`);

      // update conditions
      for (const child of action_done["suc"]) {
        // successor agent
        let j = child[0]-1;
        // index of successor action
        let idx = instructions[j].findIndex(ele => ele["id"] == child[1]);
        // not found -> error
        if (idx == -1) {
          logger.info("fail to find agent-%d's action %s", j+1, child[1]);
          process.exit(0);
        }
        // found -> remove corresponding predecessors
        instructions[j][idx].pre = instructions[j][idx].pre.filter(
          ele => !(ele[0]-1 == i && ele[1] == action_done.id)
        );
        // trigger other actions
        if (isempty(instructions[j][idx].pre)) act(j, idx);
      }
      check_termination(i, action_done);
    });
  }

  // initiate
  for (let i = 0; i < N; ++i) {
    if (instructions[i].length == 0) {
      ++fin_agents_num;
      if (fin_agents_num >= N) {
        logger.info("sum_of_costs (ms): %f", 0);
        logger.info("    makespan (ms): %f", 0);
        process.exit(0);
      }
    } else if (isempty(instructions[i][0].pre)) {
      playSound(NETWORK, i, 3);
      act(i, 0);
    }
  }
};


// setup toio robots
const setup = async (args) => {
  /*
   * step 1: wait for edge_controllers
   */
  let NETWORK = [];    // agent -> { socket, offset, cube_id }
  let init_locations = [];
  const N = get_num_agents(args);
  // start server
  const io = new Server(args.port);
  io.on("connection", (socket) => {
    logger.info("connected to one edge_controller %s", socket.id);
    socket.once("message", data => {
      msg = JSON.parse(data);
      if (msg.type != "init") return;
      for (let i = 0; i < msg.body.length; ++i) {
        const info = {socket: socket, offset: i, cube_id: msg.body[i].id};
        NETWORK.push(info);
        init_locations.push({cube_id: msg.body[i].id, x: msg.body[i].x, y: msg.body[i].y});
      }
    });
  });
  while (NETWORK.length < N) await sleep(100);
  // wait for additional sockets
  await sleep(args.wait_time);
  // organize network
  const compare_cubes = (a, b) => (a.cube_id < b.cube_id) ? 1 : -1;
  NETWORK.sort(compare_cubes);
  init_locations.sort(compare_cubes);
  const sockets = await io.fetchSockets();

  /*
   * step 2: setup problem instance
   */
  const config = get_config(args, init_locations);

  // start action
  let init_operation_id_arr = [...Array(N)].fill(0);

  // add listener to know operation id of robots
  for (const socket of sockets) {
    socket.on("message", data => {
      let msg = JSON.parse(data);
      if (msg.type != "report") return;
      let i = get_agent_from_socket(socket.id, msg.body.agent, NETWORK);
      init_operation_id_arr[i] = msg.body.operation_id;
      turnOnLight(NETWORK, i);
    });
  };

  // send move action
  for (let i = 0; i < N; ++i) {
    playSound(NETWORK, i, 1);
    let c = config.agents[i];
    moveTo(NETWORK, i, c.x_init, c.y_init, args.max_speed);
  }

  // wait for initialization of robots
  while (init_operation_id_arr.some(e => e == 0)) await sleep(100);
  for (const socket of sockets) socket.removeAllListeners("message");

  /*
   * step 3: send request
   */
  // try to connect planning module
  const url = `ws://${args.planning_address}:${args.planning_port}`;
  logger.info("try to connect %s", url);
  const ws = new WebSocket(url);

  // request
  let time_start = null;
  ws.on("open", () => {
    logger.info("request plan");
    time_start = performance.now();
    ws.send(JSON.stringify(config));
  });

  ws.on("error", (err) => { logger.info(err); process.exit(0); });

  // receive message
  let instructions = null;
  ws.once("message", (data) => {
    logger.info("received instructions");
    const msg = JSON.parse(data);
    let planning_time = performance.now() - time_start;
    if (msg.status === "success") {
      logger.info("planning: success, planning time (ms): %f", planning_time);
      ws.removeAllListeners("error");
      execute(msg.instructions, sockets, init_operation_id_arr, ws, NETWORK, args.max_speed);
    } else {
      logger.info("planning: failure, planning time (ms): %f", planning_time);
      process.exit(0);
    }
  });
};


// argparse
const parser = new ArgumentParser({});
parser.add_argument('-i', '--instance', {required: true});
parser.add_argument('-v', '--max_speed', {default: 80});
parser.add_argument('-p', '--port', {default: 3000});
parser.add_argument('-k', '--num_agents', {default: 1000});
parser.add_argument('-w', '--wait_time', {default: 2000});
parser.add_argument('-r', '--reversed', {action: "store_true"});
parser.add_argument('-s', '--use_current_starts', {action: "store_true"});
parser.add_argument('-A', '--planning-address', {default: "127.0.0.1"});
parser.add_argument('-P', '--planning-port', {default: 8081});

const args = parser.parse_args();

setup(args);
