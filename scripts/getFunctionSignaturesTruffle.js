// designed to be runned with `truffle exec`
// prints out function signatures used for the TxPermissionHbbft Contract.
// this method got replaced by getFunctionSignatures.js - what uses a method that does not require truffle and a real network.

//import Web3 from 'web3';
// const web3 = new Web3;


const KeyGenHistory = artifacts.require('KeyGenHistory');
const ValidatorSetHbbft = artifacts.require('ValidatorSetHbbft');

//const AdminUpgradeabilityProxy = artifacts.require('AdminUpgradeabilityProxy');


function getFunctionCallSignature(hexString) {

  hexString.substring();
}




async function doPrintSignatures() {

  console.log('doPrintSignatures()');

  const accounts = await web3.eth.getAccounts();
  const account = accounts[0];
  console.log('using account: ', account);

  //

  const keyGenHistory = await KeyGenHistory.at('0x7000000000000000000000000000000000000001');

  const valSet = await ValidatorSetHbbft.at('0x1000000000000000000000000000000000000001');

  // address _maliciousMiningAddress,
  // uint256 _blockNumber

  const reportMalicious = await valSet.reportMalicious.request('0xabcdef0000000000000000000000000000000001', '0x01', '0x02');
  console.log('reportMaliciousLog:', reportMalicious.data);


  //const writePart = await keyGenHistory.writePart.request('', ''):

  

  const requestPart = await keyGenHistory.writePart.request('0x1234', '0xabcd');

  console.log('writing Part');
  console.log(requestPart.data);
  

  console.log('writing Ack');
  const requestAck = await keyGenHistory.writeAcks.request('0x1234', ['0x0101', '0x0202']);
  console.log(requestAck.data);

}

console.log('script loaded.');

module.exports = function(callback) {

  

  doPrintSignatures().then(()=>{
    callback();
  }).catch((e) => {
    console.error('An Error occured:');
    callback(e);
  });

}

// console.log('starting update process');

//const newContract = new web3.eth.Contract();
// deployContracts();

// console.log('update started');
