const fs = require('fs');
const yaml = require('js-yaml');

const sleep = async (ms) => {
  return new Promise(r => setTimeout(r, ms));
};

const get_config = (args) => {
  let config = yaml.load(fs.readFileSync(args.instance, 'utf8'));
  const num_agents = Math.min(config["instance"]["agents"].length, args.num_agents);
  return config;
}

module.exports = { sleep, get_config };
