const fs = require('fs');
const yaml = require('js-yaml');

const sleep = async (ms) => {
  return new Promise(r => setTimeout(r, ms));
};

const get_config = (args) => {
  let config = yaml.load(fs.readFileSync(args.instance, 'utf8'));
  const num_agents = Math.min(config["instance"]["agents"].length, args.num_agents);
  config.instance.agents = config.instance.agents.slice(0, num_agents);
  if (args.reversed === "true") {
    for (let i = 0; i < num_agents; ++i) {
      let tmp_x = config.instance.agents[i].x_init;
      let tmp_y = config.instance.agents[i].y_init;
      config.instance.agents[i].x_init = config.instance.agents[i].x_goal;
      config.instance.agents[i].y_init = config.instance.agents[i].y_goal;
      config.instance.agents[i].x_goal = tmp_x;
      config.instance.agents[i].y_goal = tmp_y;
    }
  }
  return config;
};

const get_consistent_cut = (instructions, committed_indexes) => {
  const num_agents = instructions.length;

  // initialize table
  let table = [];
  let Q = [];
  for (let i = 0; i < num_agents; ++i) {
    table.push(Math.min(committed_indexes[i], instructions[i].length - 1));
    Q.push(i);
  }
  while (Q.length > 0) {
    let i = Q[0];
    Q.shift();

    for (let predecessor of instructions[i][table[i]].pre) {
      let j = predecessor[0] - 1;  // Julia index
      let id = predecessor[1];
      let l = instructions[j].findIndex(ele => ele.id == id);
      if (j == i) continue;  // skip self
      if (table[j] < l) {
        Q.push(j);
        table[j] = l;
      }
    }
  }

  return table;
};

module.exports = { sleep, get_config, get_consistent_cut };
