
// uploads smart contract source code to a blockscout instance.

//curl -d '{"addressHash":"0xc63BB6555C90846afACaC08A0F0Aa5caFCB382a1","compilerVersion":"v0.5.4+commit.9549d8ff", "contractSourceCode":"pragma solidity ^0.5.4; contract Test { }","name":"Test","optimization":false}' -H "Content-Type: application/json" -X POST "https://blockscout.com/poa/sokol/api?module=contract&action=verify"

//import * as fs from 'fs';
const fs = require('fs');


// requires to flatten contracts first:
// truffle-flattener contracts/SimpleToken.sol > FlattenedSimpleToken.sol
var XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;



const contractSourceRaw = fs.readFileSync(`flat/ValidatorSetHbbft_flat.sol`);

const contractName='ValidatorSetHbbft';
const optimizer='true';
const optimizerRuns='200';

console.log(contractSourceRaw);

//echo "url encode the source..."

//export $contractSource="$(perl -MURI::Escape -e 'print uri_escape($ARGV[0]);' "$contractSourceRaw")"
//#echo $contractSource

const url = 'http://127.0.0.1:4000/api?module=contract&action=verify';


request = {
  "addressHash":"0x1000000000000000000000000000000000000001",
  "compilerVersion":"v0.5.16+commit.9c3226ce",
  "contractSourceCode":contractSourceRaw,
  "name":contractName,
  "optimization":optimizer,
  "optimizationRuns": optimizerRuns
}

//' -H "Content-Type: application/json" -X POST "
console.log('exporting: ', request);


var xhr = new XMLHttpRequest();
xhr.withCredentials = true;
xhr.addEventListener("readystatechange", function () {
  if (this.readyState === 4) {
    console.log(this.responseText);
  }
});

xhr.open("POST", url);
xhr.setRequestHeader("cache-control", "no-cache");
xhr.setRequestHeader("content-type", "application/json;charset=UTF-8");
console.log('sending raw data: ', JSON.stringify(request));
xhr.send(JSON.stringify(request));

//echo "exporting..."
//curl -d '{"addressHash":"0x1000000000000000000000000000000000000001","compilerVersion":"v0.5.16+commit.9c3226ce", "contractSourceCode":"'$contractSource'","name":"$contractName","optimization":"true", "optimizationRuns": "200"}' -H "Content-Type: application/json" -X POST "http://127.0.0.1:4000/api?module=contract&action=verify"
