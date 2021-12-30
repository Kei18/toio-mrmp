// client

const { NearScanner } = require('@toio/scanner');
const { io } = require("socket.io-client");
const { ArgumentParser } = require("argparse");
const { sleep, getLogger } = require("./utils");

const logger = getLogger();

const parser = new ArgumentParser({});
parser.add_argument('-k', '--agents', {help: "number of agents", default: 1});
parser.add_argument('-a', '--addr', {default: "localhost"});
parser.add_argument('-p', '--port', {help: "port (as client)", default: 3000});
const args = parser.parse_args();

const toioSetup = async (num_agents) => {
  let cubes = await new NearScanner(num_agents).start();
  cubes.sort(function(a, b) { return (a.id < b.id) ? 1 : -1; });
  for (let i = 0; i < cubes.length; ++i) await cubes[i].connect();
  logger.info("connected to %d robots", num_agents);

  const init_light_operations = [
    {blue: 0, green: 0, red: 255, durationMs: 500},
    {blue: 255, green: 255, red: 0, durationMs: 500},
  ];
  for (let i = 0; i < cubes.length; ++i) {
    cubes[i].playPresetSound(7);
    cubes[i].turnOnLightWithScenario(init_light_operations, 3);
  }
  return cubes;
};

const startServer = (cubes) => {
  logger.info("setup server");

  // start client
  const socket = io(`ws://${args.addr}:${args.port}/`);
  socket.on("connect", async () => {
    logger.info("connected to controller: %s", socket.id);

    let init_locs = [];
    let num_setup_agents = 0;
    cubes.forEach((cube, i) => {
      init_locs.push({});
      cube.once("id:position-id", (data) => {
        init_locs[i] = {id: cube.id, x: data.x, y: data.y};
        ++num_setup_agents;
      });
    });
    while (num_setup_agents < cubes.length) await sleep(500);
    logger.info("initial locations: %s", init_locs);

    // initialization
    socket.send(JSON.stringify({type: "init", body: init_locs}));
  });

  // instruction
  socket.on("message", (data) => {
    logger.info("receive message: %s", data);
    const msg = JSON.parse(data);
    let params = JSON.stringify(msg.params);
    params = params.substr(1, params.length-2);
    const instruction = `cubes[${msg.agent}].${msg.operation}(${params})`;
    eval(instruction);
  });

  // report
  cubes.forEach((cube, i) => cube.on("motor:response", (operation_id) => {
    socket.send(JSON.stringify(
      {type: "report", body: {"agent": i, "operation_id": operation_id}}
    ));
  }));

  socket.on("disconnect", () => { logger.info("disconnected"); });
};

toioSetup(args.agents).then(startServer);
