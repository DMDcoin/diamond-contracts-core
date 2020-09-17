

//import * as Web3 from "web3";
import Web3 from 'web3';

const prov = new Web3.providers.HttpProvider("http://127.0.0.1:8545");
const web3 = new Web3(prov);

async function debugTX(txHash: string) {
  const tx = await web3.eth.getTransaction(txHash);
  const tx2 = web3.eth.getTransactionReceipt(txHash);
  console.log(tx);
  console.log(tx2);
}


async function analyseTransactionsOnSubscribedBlocks() {

  let failed = 0;
  let success = 0;

  web3.eth.subscribe("newBlockHeaders", (error, blockHeader) => {
    if (blockHeader) {
      web3.eth.getBlock(blockHeader.hash).then((value) => {
        value.transactions.forEach((tx) => {
          web3.eth.getTransactionReceipt(tx).then((receipt=>{
            if (receipt.status) {
              console.log("All Good: ", receipt);
              success++;
            } else {
              console.log("Error: ", receipt);
              failed++;
            }
          }))
        })
      })
    }
  })
}



async function analyseTransactionsOnSubscribedBlocks() {

  let failed = 0;
  let success = 0;

  web3.eth.subscribe("newBlockHeaders", (error, blockHeader) => {
    if (blockHeader) {
      web3.eth.getBlock(blockHeader.hash).then((value) => {
        value.transactions.forEach((tx) => {
          web3.eth.getTransactionReceipt(tx).then((receipt=>{
            if (receipt.status) {
              console.log("All Good: ", receipt);
              success++;
            } else {
              console.log("Error: ", receipt);
              failed++;
            }
          }))
        })
      })
    }
  })
}



debugTX("0xd79bedb5d1ea769b7a86f887e218b82beaa866fac6603a75c25e5c020f51b337");

