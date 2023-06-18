const child = require('child_process');
const fs = require('fs');

main();

async function main() {
  let dir = './contracts/';

  if (!fs.existsSync(dir)) {
    dir = '.' + dir;
  }

  const filenames = fs.readdirSync(dir);
  let contracts = [];

  for (let i = 0; i < filenames.length; i++) {

    if (filenames[i].endsWith('.sol')) {
      contracts.push(filenames[i]);
    }
  }

  fs.mkdirSync("./audit", { recursive: true });

  for (let i = 0; i < contracts.length; i++) {
    const promise = child.spawn('myth', [`analyze`, `./contracts/${[contracts[i]]}`]);
    console.log(`${[contracts[i]]} audit have started`);
    promise.stdout.on('data', (data) => {
      fs.writeFile(`./audit/${[contracts[i].slice(0, -4)]}.txt`, data, function () { }
      )
      console.log(`results were written into the ./audit/${[contracts[i].slice(0, -4)]}.txt`)
    });

    promise.stderr.on('data', (data) => {
      console.error(`stderr: ${data}`);
    });

    promise.on('close', (code) => {
      console.log(`exited with code ${code}`);
    });
  }
}
