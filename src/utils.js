const fs = require('fs');
const yaml = require('js-yaml');
const pino = require('pino');

const sleep = async (ms) => {
  return new Promise(r => setTimeout(r, ms));
};

const isempty = (arr) => { return arr.length == 0; };

const get_num_agents = (args) => {
  let config = yaml.load(fs.readFileSync(args.instance, 'utf8'));
  return Math.min(config["instance"]["agents"].length, args.num_agents);
};

const get_config = (args, init_locations) => {
  let config = yaml.load(fs.readFileSync(args.instance, 'utf8'));
  const N = get_num_agents(args);
  const num_agents = get_num_agents(args);
  config.instance.agents = config.instance.agents.slice(0, num_agents);
  if (args.reversed) {
    for (let i = 0; i < num_agents; ++i) {
      let tmp_x = config.instance.agents[i].x_init;
      let tmp_y = config.instance.agents[i].y_init;
      config.instance.agents[i].x_init = config.instance.agents[i].x_goal;
      config.instance.agents[i].y_init = config.instance.agents[i].y_goal;
      config.instance.agents[i].x_goal = tmp_x;
      config.instance.agents[i].y_goal = tmp_y;
    }
  }
  if (args.use_current_starts) {
    for (let i = 0; i < N; ++i) {
      let locs = init_locations[i];
      config.instance.agents[i].x_init = locs.x;
      config.instance.agents[i].y_init = locs.y;
    }
  }
  return config;
};

const get_consistent_commit = (instructions, committed_indexes, offset=0) => {
  const N = instructions.length;
  // will be returned
  let consistent_indexes = committed_indexes
      .map((k, i) => Math.min(k + offset, instructions[i].length-1));
  // agent queue
  let Q = Array(N).fill(0).map((e, i) => i);
  while (!isempty(Q)) {
    // pop
    let i = Q[0];
    Q.shift();
    if (consistent_indexes[i] < 0) continue;
    for (let k = Math.max(committed_indexes[i], 0); k <= consistent_indexes[i]; ++k) {
      for (let predecessor of instructions[i][k].pre) {
        let j = predecessor[0] - 1;  // Julia index
        if (j == i) continue;  // skip self
        let id = predecessor[1];
        let l = instructions[j].findIndex(ele => ele.id == id);
        if (consistent_indexes[j] < l) {
          Q.push(j);
          consistent_indexes[j] = l;
        }
      }
    }
  }
  return consistent_indexes;
};

const get_agent_from_socket = (socket_id, agent_index, network) => {
  for (let i = 0; i < network.length; ++i) {
    if (network[i].socket.id == socket_id && network[i].offset == agent_index) {
      return i;
    }
  }
  return nothing;
};

const moveTo = (network, i, x, y, speed=80) => {
  let ele = network[i];
  ele.socket.send(JSON.stringify({
    agent: ele.offset, operation: "moveTo", params: [
      [{x: x, y: y}],
      {maxSpeed: speed, moveType: 2, speedType: 3}
    ]
  }));
};

const playSound = (network, i, sound_type=0) => {
  let ele = network[i];
  ele.socket.send(JSON.stringify({
    agent: ele.offset, operation: "playPresetSound", params: [sound_type]
  }));
};

const turnOnLight= (network, i, operation={blue: 255, green: 0, red: 0, durationMs: 2550}) => {
  let ele = network[i];
  ele.socket.send(JSON.stringify({
    agent: ele.offset, operation: "turnOnLightWithScenario", params: [[operation]]
  }));
};

const turnOffLight= (network, i) => {
  let ele = network[i];
  ele.socket.send(JSON.stringify({
    agent: ele.offset, operation: "turnOffLight", params: []
  }));
};

const getLogger = () => {
  return pino({
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: "yyyy-mm-dd HH:MM:ss.l",
        ignore: 'pid,hostname',
        singleLine: true
      }
    },
  });
};


module.exports = {
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
};
