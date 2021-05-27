

// import Web3 from 'web3';
// const web3 = new Web3;




const AdminUpgradeabilityProxy = artifacts.require('AdminUpgradeabilityProxy');



async function doDeployContracts() {

  const accounts = await web3.eth.getAccounts();
  const account = accounts[0];
  console.log('using account: ', account);


  //const certifierProxyAddress = "0x5000000000000000000000000000000000000001";
  //const certifierProxyAddress = "0x5000000000000000000000000000000000000001";
  


// const VALIDATOR_SET_CONTRACT = '0x1000000000000000000000000000000000000001';
// const BLOCK_REWARD_CONTRACT = '0x2000000000000000000000000000000000000001';
// const RANDOM_CONTRACT = '0x3000000000000000000000000000000000000001';
// const STAKING_CONTRACT = '0x1100000000000000000000000000000000000001';
// const PERMISSION_CONTRACT = '0x4000000000000000000000000000000000000001';
// const CERTIFIER_CONTRACT = '0x5000000000000000000000000000000000000001';
// const KEY_GEN_HISTORY_CONTRACT = '0x7000000000000000000000000000000000000001';


  const contractToUpdate = 'TxPermissionHbbft';


  const contractAddresses = {
    TxPermissionHbbft: '0x4000000000000000000000000000000000000001'
  }

  const address = contractAddresses[contractToUpdate];

  console.log(`Updating ${contractToUpdate} on address ${address}`);

  const currentProxy = await AdminUpgradeabilityProxy.at(address);

  let currentImplementationAddress = await currentProxy.implementation.call();

  console.log(`current implementation: `, currentImplementationAddress);

  //console.log('proxyMethods: ',await currentProxy.methods);
  let currentAdmin = await currentProxy.admin.call();
  
  console.log('currentAdmin: ', currentAdmin);

  if (currentAdmin !== account) {
    const errorMessage = `The Account ${account} is not allowed to upgrade. Admin is: ${currentAdmin}`;
    // console.error(errorMessage);
    throw Error(errorMessage);
  }

  const contractArtifact = artifacts.require(contractToUpdate);

  console.log('deploying new contract...');
  const newContract = await contractArtifact.new();
  console.log('deployed to ', newContract.address);
  console.log('upgrading...');
  const txResult = await currentProxy.upgradeTo(newContract.address);
  console.log('upgrade result: ', txResult);

  console.log('verifying upgrade...');

  currentImplementationAddress = await currentProxy.implementation.call();

  console.log(`new implementation address: `, currentImplementationAddress);
}

module.exports = async function deployContracts(callback) {

  console.log('deploying contracts.');

  doDeployContracts().then(()=>{
    console.log('upgrade finished.');
    callback();
  }).catch((e) => {
    console.error('An Error occured while upgrading contracts');
    callback(e);
  })
}

// console.log('starting update process');

//const newContract = new web3.eth.Contract();
// deployContracts();

// console.log('update started');
