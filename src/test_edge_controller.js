/*
 * simple test of edge controller
 */

const { ArgumentParser } = require("argparse");
const { Server } = require("socket.io");
const { getLogger } = require("./utils");

const parser = new ArgumentParser({});
parser.add_argument('-p', '--port', {default: 3000});
const args = parser.parse_args();
const logger = getLogger();

const io = new Server(args.port);

const time_interval = 1000;
const speed = 30;

io.on("connection", (socket) => {
  logger.info("connected to one edge_controller %s", socket.id);

  socket.once("message", data => {
    msg = JSON.parse(data);
    logger.info(msg);

    let cnt = 0;
    setInterval(() => {
      ++cnt;
      for (let i = 0; i < msg.body.length; ++i) {
        params = (cnt % 2 == 0) ? [speed, speed, time_interval] : [-speed, -speed, time_interval];
        socket.send(JSON.stringify({
          agent: i, operation: "move", params: params
        }));
      }
    }, time_interval);

  });
});
