// designed to be executed with `truffle exec`
// uses the first account and fills the 

//import feedAccounts from './ts/build/feedAccounts';



async function doFeedAccounts(web3, countOfRecipients, valueToFeed = '100000000000000000000') {

  const allAddresses = await web3.eth.getAccounts();

  const addresses = allAddresses.slice(1, countOfRecipients);

  const mainAddress =  allAddresses[0];

  console.log('Balances before run:');

  let nonceBase = await web3.eth.getTransactionCount(mainAddress);

  console.log(`Current Transaction Count: ${nonceBase}`);
  //going to cache the number of transactions,
  // so the signing process does not

  //return;

  for(let i = 0; i < countOfRecipients; i++) {

    //don't continue to loop if there are no known adresses anymore.
    if (!addresses[i]){
      break;
    }

    //console.log(`next nonce: ${nonce}`);
    const txObj = {
        from: mainAddress,
        to: addresses[i],
        gas: 21000,
        gasPrice: '090000000000',
        value: valueToFeed,
        nonce: nonceBase + i,
    };

    console.log(`sending TX: `, txObj);
    
    await web3.eth.sendTransaction(txObj);
  }

  console.log(`All Transactions send to the blockchain.`);

  //console.log('send Result: ', sendResult);
  //const newTargetAddressBalance = await web3.eth.getBalance(addr);
  //console.log('new target address Balance: ', newTargetAddressBalance);
}

module.exports = function(callback) {

  

  doFeedAccounts(web3, 99, web3.utils.toWei('100')).then(()=>{
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
