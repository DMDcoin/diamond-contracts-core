// CLI Tool for retrieving values from the network.


const ValidatorSetHbbft = artifacts.require('ValidatorSetHbbft');
const KeyGenHistory = artifacts.require('KeyGenHistory');
const Staking = artifacts.require('StakingHbbft');


async function run() {

  const logDebug = true;

  function log(message) {
    if (logDebug) {
      console.log(message);
    }
  }
  

  const validatorSetHbbft = await ValidatorSetHbbft.at('0x1000000000000000000000000000000000000001');
  const stakingContractAddress = await validatorSetHbbft.stakingContract.call();
  log(`stakingContractAddress: ${stakingContractAddress}`);
  const staking = await Staking.at(stakingContractAddress);
  const toBeElected = await staking.getPoolsToBeElected.call();
  log(`toBeElected:`);
  console.log(toBeElected);
  
}


module.exports = function(callback) {
  run().then(()=>{
    callback();
  }).catch((e) => {
    console.error('An Error occured:');
    callback(e);
  });
}

//const keyGenHistory = await KeyGenHistory.at('');
