

// import Web3 from 'web3';
// const web3 = new Web3;



const Certifier = artifacts.require('CertifierHbbft');
const AdminUpgradeabilityProxy = artifacts.require('AdminUpgradeabilityProxy');



async function doDeployContracts() {

  const accounts = await web3.eth.getAccounts();
  const account = accounts[0];
  console.log('using account: ', account);


  //const certifierProxyAddress = "0x5000000000000000000000000000000000000001";
  const certifierProxyAddress = "0x5000000000000000000000000000000000000001";
  const currentProxy = await AdminUpgradeabilityProxy.at(certifierProxyAddress);

  //console.log('proxyMethods: ',await currentProxy.methods);
  const currentAdmin = await currentProxy.admin.call();
  
  console.log('currentAdmin: ', currentAdmin);

  if (currentAdmin !== account) {
    const errorMessage = `The Account ${account} is not allowed to upgrade. Admin is: ${currentAdmin}`;
    // console.error(errorMessage);
    throw Error(errorMessage);
  }

  const certifier = await Certifier.new();
  console.log('deployed to ', certifier.address);
  console.log('upgrading...');

  const txResult = await currentProxy.upgradeTo.call(certifier.address);

  console.log('upgrade result: ', txResult);
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
