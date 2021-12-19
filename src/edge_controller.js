// client

const { NearScanner } = require('@toio/scanner');
const { io } = require("socket.io-client");
const { ArgumentParser } = require("argparse");
const { sleep } = require("./utils");

const parser = new ArgumentParser({});
parser.add_argument('-k', '--agents', {help: "number of agents", default: 1});
parser.add_argument('-a', '--addr', {default: "localhost"});
parser.add_argument('-p', '--port', {help: "port (as client)", default: 3000});
const args = parser.parse_args();

toioSetup(args.agents).then((res) => {
  const cubes = res[0];
  const initial_locs = res[1];
  console.log("initial locs:", initial_locs);

  // start client
  const socket = io(`ws://${args.addr}:${args.port}/`);
  socket.on("connect", () => {
    console.log("connected to controller: %s", socket.id);

    // initialization
    socket.send(JSON.stringify({type: "init", body: initial_locs}));
  });

  // instruction
  socket.on("message", (data) => {
    console.log("receive message: %s", data);
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

  socket.on("disconnect", () => {
    console.log("disconnected");
  });
});


async function toioSetup(num_agents) {
  let cubes = await new NearScanner(num_agents).start();
  cubes.sort(function(a, b) { return (a.id < b.id) ? 1 : -1; });
  let setup_cube_num = 0;
  let initial_locs = [];
  for (let i = 0; i < num_agents; ++i) {
    initial_locs.push({});
    let cube = await cubes[i].connect();
    cube.once("id:position-id", data => {
      initial_locs[i] = { id: cube.id, x: data.x, y: data.y };
      ++setup_cube_num;
    });
  }
  while (setup_cube_num < num_agents) await sleep(500);

  console.log("connected to %d robots", num_agents);
  return [cubes, initial_locs];
};
