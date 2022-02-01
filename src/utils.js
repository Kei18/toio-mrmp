/*
 * utilities
 */

const fs = require('fs');
const yaml = require('js-yaml');
const pino = require('pino');

const sleep = async (ms) => {
  return new Promise(r => setTimeout(r, ms));
};

const isempty = (arr) => { return arr.length == 0; };

const get_num_agents = (args) => {
  let config = yaml.load(fs.readFileSync(args.instance, 'utf8'));
  return Math.min(config.agents.length, args.num_agents);
};

const get_config = (args, init_locations) => {
  let config = yaml.load(fs.readFileSync(args.instance, 'utf8'));
  const N = get_num_agents(args);
  const num_agents = get_num_agents(args);
  config.agents = config.agents.slice(0, num_agents);
  if (args.reversed) {
    for (let i = 0; i < num_agents; ++i) {
      let tmp_x = config.agents[i].x_init;
      let tmp_y = config.agents[i].y_init;
      config.agents[i].x_init = config.agents[i].x_goal;
      config.agents[i].y_init = config.agents[i].y_goal;
      config.agents[i].x_goal = tmp_x;
      config.agents[i].y_goal = tmp_y;
    }
  }
  if (args.use_current_starts) {
    for (let i = 0; i < N; ++i) {
      let locs = init_locations[i];
      config.agents[i].x_init = locs.x;
      config.agents[i].y_init = locs.y;
    }
  }
  return config;
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
  get_agent_from_socket,
  moveTo,
  playSound,
  turnOnLight,
  turnOffLight,
  getLogger
};
