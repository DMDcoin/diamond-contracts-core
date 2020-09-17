
//just a script the helps analysing failing transactions.

 
//var assert = require('assert');
describe('Failed Transactions', function () {
 it('should return number of charachters in a string', async function () {

      // AssertionError: expected promise to be rejected with an error including 'Mining address can\'t be 0' but got 'Transaction: 0xd79bedb5d1ea769b7a86f887e218b82beaa866fac6603a75c25e5c020f51b337 exited with an error (status 0). \n     Please check that the transaction:\n     - satisfies all conditions set by Solidity `require` statements.\n     - does not trigger a Solidity `revert` statement.\n'
      // + expected - actual

      // -Transaction: 0xd79bedb5d1ea769b7a86f887e218b82beaa866fac6603a75c25e5c020f51b337 exited with an error (status 0). 
      // -     Please check that the transaction:
      // -     - satisfies all conditions set by Solidity `require` statements.
      // -     - does not trigger a Solidity `revert` statement.
      // +Mining address can't be 0

      await debugTX("0xd79bedb5d1ea769b7a86f887e218b82beaa866fac6603a75c25e5c020f51b337");

      //this transacion cooresponds to TX: ✓ should create a new pool (1064ms)
      //await debugTX("0xbe61ee4f4abd11a60dc518e1f95508f3aca5f4f7fcaa9f56a73ad7d1803930ef");
    });
});



async function debugTX(txHash) {
  const tx = await web3.eth.getTransaction(txHash);
  const tx2 = await web3.eth.getTransactionReceipt(txHash);
  console.log(tx);
  console.log(tx2);  
}

