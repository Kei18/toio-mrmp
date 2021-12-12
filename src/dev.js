const { NearestScanner } = require('@toio/scanner');

async function main() {
  const cube = await new NearestScanner().start();
  await cube.connect();
  cube.on("motor:response", data => { console.log("operation:", data); });
  await sleep(1000);
  cube.moveTo([{x: 80, y: 600}, {x: 280, y: 600}], {maxSpeed: 80, moveType: 2});
  await sleep(1000);
  // cube.stop();
  cube.moveTo([{x: 280, y: 800}], {maxSpeed: 80, moveType: 2});
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

main();
