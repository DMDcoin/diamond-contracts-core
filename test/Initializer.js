const AdminUpgradeabilityProxy = artifacts.require('AdminUpgradeabilityProxy');
const ValidatorSetHbbft = artifacts.require('ValidatorSetHbbft');
const BlockRewardHbbft = artifacts.require('BlockRewardHbbft');
const RandomHbbft = artifacts.require('RandomHbbft');
const StakingHbbft = artifacts.require('StakingHbbftCoins');
const TxPermission = artifacts.require('TxPermissionHbbft');
const Certifier = artifacts.require('CertifierHbbft');
const KeyGenHistory = artifacts.require('KeyGenHistory');
const Initializer =  artifacts.require('InitializerHbbft');
const testdata = require('./testhelpers/data');

const BN = web3.utils.BN;

require('chai')
  .use(require('chai-as-promised'))
  .use(require('chai-bn')(BN))
  .should();

contract('InitializerHbbft', async accounts => {
  
  let blockRewardHbbft;
  let randomHbbft;
  let stakingHbbft;
  let txPermission;
  let certifier;
  let validatorSetHbbft;
  let keyGenHistory;

  let owner = accounts[0];
  
  let miningAddresses = [
    '0x0000000000000000000000000000000000000111',
    '0x0000000000000000000000000000000000000222',
    '0x0000000000000000000000000000000000000333'
  ];

  let stakingAddresses = [
    '0x1110000000000000000000000000000000000000',
    '0x2220000000000000000000000000000000000000',
    '0x3330000000000000000000000000000000000000'
  ];

  let publicKeys = [
    '0x1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1',
    '0x1BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1',
    '0x2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2',
    '0x2BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2',
    '0x3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3',
    '0x3BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB3'
  ];
  
  let candidateMinStake = new BN(web3.utils.toWei('2', 'ether'));
  let delegatorMinStake = new BN(web3.utils.toWei('1', 'ether'));
  
  let initialValidatorsIpAddresses = [
     '0x10100000000000000000000000000000', 
     '0x20200000000000000000000000000000', 
     '0x30300000000000000000000000000000'];

  const { parts, acks } = testdata.getTestPartNAcks();

  // one epoch in 5 seconds day.
  const stakingEpochDuration = new BN(5);

  // the transition time window is second.
  const stakingTransitionwindowLength = new BN(1);

  const stakingWithdrawDisallowPeriod = new BN(2);

  describe('Initializer', async () => {

    it('Deploy Contracts', async () => {

      // Deploy ValidatorSetHbbft contract
      validatorSetHbbft = await ValidatorSetHbbft.new();
      validatorSetHbbft = await AdminUpgradeabilityProxy.new(validatorSetHbbft.address, owner, []);
      validatorSetHbbft = await ValidatorSetHbbft.at(validatorSetHbbft.address);

      // Deploy BlockRewardHbbft contract
      blockRewardHbbft = await BlockRewardHbbft.new();
      blockRewardHbbft = await AdminUpgradeabilityProxy.new(blockRewardHbbft.address, owner, []);
      blockRewardHbbft = await BlockRewardHbbft.at(blockRewardHbbft.address);
      // Deploy RandomHbbft contract
      randomHbbft = await RandomHbbft.new();
      randomHbbft = await AdminUpgradeabilityProxy.new(randomHbbft.address, owner, []);
      randomHbbft = await RandomHbbft.at(randomHbbft.address);
      // Deploy StakingHbbft contract
      stakingHbbft = await StakingHbbft.new();
      stakingHbbft = await AdminUpgradeabilityProxy.new(stakingHbbft.address, owner, []);
      stakingHbbft = await StakingHbbft.at(stakingHbbft.address);
      // Deploy TxPermission contract
      txPermission = await TxPermission.new();
      txPermission = await AdminUpgradeabilityProxy.new(txPermission.address, owner, []);
      txPermission = await TxPermission.at(txPermission.address);
      // Deploy Certifier contract
      certifier = await Certifier.new();
      certifier = await AdminUpgradeabilityProxy.new(certifier.address, owner, []);
      certifier = await Certifier.at(certifier.address);
      // Deploy KeyGenHistory contract
      keyGenHistory = await KeyGenHistory.new();
      keyGenHistory = await AdminUpgradeabilityProxy.new(keyGenHistory.address, owner, []);
      keyGenHistory = await KeyGenHistory.at(keyGenHistory.address);
      
      // analysis of admin addresses.
      // console.log(await validatorSetHbbft.getInfo());
      // console.log(owner);
      // console.log(await validatorSetHbbft.senderAddress.call());
      // console.log(await validatorSetHbbft.adminAddress.call());
      // console.log(await blockRewardHbbft.adminAddress.call());
      // console.log(await randomHbbft.adminAddress.call());
      // console.log(await stakingHbbft.adminAddress.call());
      // console.log(await txPermission.adminAddress.call());

    });

    it('Deploy Initializer', async() => {
   
      const contractAddresses = [ // _contracts
        validatorSetHbbft.address,
        blockRewardHbbft.address,
        randomHbbft.address,
        stakingHbbft.address,
        txPermission.address,
        certifier.address,
        keyGenHistory.address
      ];

      const stakingParams = [
        delegatorMinStake, //_delegatorMinStake
        candidateMinStake, //_candidateMinStake
        stakingEpochDuration, //_stakingEpochDuration
        stakingTransitionwindowLength, //_stakingTransitionTimeframeLength
        stakingWithdrawDisallowPeriod, //_stakingWithdrawDisallowPeriod
      ];
 
      await Initializer.new(
        contractAddresses ,
        owner, // _owner
        miningAddresses, // _miningAddresses
        stakingAddresses, // _stakingAddresses
        stakingParams,
        publicKeys,
        initialValidatorsIpAddresses,
        parts,
        acks);

      const validators = await validatorSetHbbft.getValidators.call();

      validators.should.be.deep.equal(miningAddresses);

      //candidateMinStake = await stakingHbbft.candidateMinStake.call();
      //delegatorMinStake = await stakingHbbft.delegatorMinStake.call();


    })

  }); // describe

}); // contract

