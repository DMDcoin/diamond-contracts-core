const web3 = require('web3');

const Web3EthAbi = require('web3-eth-abi');
const fs = require('fs');

fullFile = fs.readFileSync("build/contracts/KeyGenHistory.json").toString().trim();

const contractObj = JSON.parse(fullFile);
const ABI = contractObj.abi;
//json.load(open('/path/to/your/truffle/workspace' + '/build/contracts/AdditionContract.json'))

// Concatenate function name with its param types
const prepareData = e => `${e.name}(${e.inputs.map(e => e.type)})`

//let encodedFunctionSignature = f => Web3EthAbi.encodeFunctionSignature('adopt(uint256)');
let encodedFunctionSignature = f => Web3EthAbi.encodeFunctionSignature(f);

// Parse ABI and encode its functions
const output = ABI
  .filter(e => e.type === "function")
  .flatMap(e => `${encodedFunctionSignature(prepareData(e))}: ${prepareData(e)}`)

console.log(output)