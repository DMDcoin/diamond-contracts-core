const fs = require('fs');
const solc = require('solc');
const path = require('node:path');

async function compile(dir, contractName) {
  const contractFileName = contractName + '.sol';

  const input = {
    language: 'Solidity',
    sources: {
      [contractFileName]: {
        content: fs.readFileSync(dir + contractFileName).toString()
      }
    },
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      evmVersion: "istanbul",
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object', 'evm.methodIdentifiers']
        }
      }
    }
  }

  const intermediateFoldersOfCurrentContract = dir.slice(1, -1);

  function findImports(path) {
    let sourceCodeToImport;
    if (path[0] === "@") { // directly into node_ module
      sourceCodeToImport = fs.readFileSync(`./node_modules/${path}`);
      return { contents: `${sourceCodeToImport}` };
    }
    if (dir.length === 2) { // array contract path is "./" + contract.sol, i.e simple import in the same folder as the compile.js
      sourceCodeToImport = fs.readFileSync(`./${path}`);
      return { contents: `${sourceCodeToImport}` };
    }
    if (!path.includes("/")) { // === contract to import is in the same folder as the contract we are compiling i.e the import path from the contract fiel doesn't include "/"
      sourceCodeToImport = fs.readFileSync(`./${intermediateFoldersOfCurrentContract}/${path}`);
      return { contents: `${sourceCodeToImport}` };
    }
    else { // if neither of these, contract must be (in my case) accessible from the compile.js, i.e no need to change the path
      sourceCodeToImport = fs.readFileSync(`./contracts/${path}`);
      return { contents: `${sourceCodeToImport}` }
    }
  }

  const compiled = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }))
  return compiled.contracts[contractFileName][contractName];
}

module.exports = {
  compile
}
