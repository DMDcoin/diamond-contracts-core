const AdminUpgradeabilityProxy = artifacts.require('AdminUpgradeabilityProxy');
const ValidatorSetHbbft = artifacts.require('ValidatorSetHbbftMock');
const BlockRewardHbbft = artifacts.require('BlockRewardHbbftCoinsMock');
const RandomHbbft = artifacts.require('RandomHbbft');
const StakingHbbft = artifacts.require('StakingHbbftCoins');
const TxPermission = artifacts.require('TxPermissionHbbft');
const Certifier = artifacts.require('CertifierHbbft');
const KeyGenHistory = artifacts.require('KeyGenHistory');
const Initializer = artifacts.require('InitializerHbbft');
const testdata = require('./testhelpers/data');

const BN = web3.utils.BN;

require('chai')
  .use(require('chai-as-promised'))
  .use(require('chai-bn')(BN))
  .should();

let owner;
let blockRewardHbbft;
let randomHbbft;
let stakingHbbft;
let txPermission;
let certifier;
let validatorSetHbbft;
let keyGenHistory;

let candidateMinStake = new BN(web3.utils.toWei('2', 'ether'));
let delegatorMinStake = new BN(web3.utils.toWei('1', 'ether'));

//const useUpgradeProxy = !(process.env.CONTRACTS_NO_UPGRADE_PROXY == 'true');
const useUpgradeProxy = false;
const logOutput = false;

contract('InitializerHbbft', async accounts => {


  owner = accounts[0];

  const miningAddresses = accounts.slice(11, 20);
  const stakingAddresses = accounts.slice(21, 30);

  const initializingMiningAddresses = miningAddresses.slice(0, 3);
  const initializingStakingAddresses = stakingAddresses.slice(0, 3);

  if (logOutput) {
    console.log('initial Mining Addresses', initializingMiningAddresses);
    console.log('initial Staking Addresses', initializingStakingAddresses);
  }

  //this info does not match the mininAccounts, but thats not a problem for this tests.
  let publicKeys = [
    '0x1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1',
    '0x1BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1',
    '0x2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2',
    '0x2BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2',
    '0x3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3',
    '0x3BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB3'
  ];


  let initialValidatorsIpAddresses = [
    '0x10100000000000000000000000000000',
    '0x20200000000000000000000000000000',
    '0x30300000000000000000000000000000'];

  const { parts, acks } = testdata.getTestPartNAcks();

  // one epoch in 1000 seconds.
  const stakingEpochDuration = new BN(1000);

  // the transition time window is 100 seconds.
  const stakingTransitionwindowLength = new BN(100);

  const stakingWithdrawDisallowPeriod = new BN(100);

  describe('Initializer', async () => {

    it('Deploy Contracts', async () => {

      // Deploy ValidatorSetHbbft contract
      validatorSetHbbft = await ValidatorSetHbbft.new();

      if (useUpgradeProxy) {
        validatorSetHbbft = await AdminUpgradeabilityProxy.new(validatorSetHbbft.address, owner, []);
        validatorSetHbbft = await ValidatorSetHbbft.at(validatorSetHbbft.address);
      }

      // Deploy BlockRewardHbbft contract
      blockRewardHbbft = await BlockRewardHbbft.new();

      if (useUpgradeProxy) {
        blockRewardHbbft = await AdminUpgradeabilityProxy.new(blockRewardHbbft.address, owner, []);
        blockRewardHbbft = await BlockRewardHbbft.at(blockRewardHbbft.address);
      }
      // Deploy RandomHbbft contract
      randomHbbft = await RandomHbbft.new();

      if (useUpgradeProxy) {
        randomHbbft = await AdminUpgradeabilityProxy.new(randomHbbft.address, owner, []);
        randomHbbft = await RandomHbbft.at(randomHbbft.address);
      }
      // Deploy StakingHbbft contract
      stakingHbbft = await StakingHbbft.new();
      if (useUpgradeProxy) {
        stakingHbbft = await AdminUpgradeabilityProxy.new(stakingHbbft.address, owner, []);
        stakingHbbft = await StakingHbbft.at(stakingHbbft.address);
      }
      // Deploy TxPermission contract
      txPermission = await TxPermission.new();
      if (useUpgradeProxy) {
        txPermission = await AdminUpgradeabilityProxy.new(txPermission.address, owner, []);
        txPermission = await TxPermission.at(txPermission.address);
      }
      // Deploy Certifier contract
      certifier = await Certifier.new();
      if (useUpgradeProxy) {
        certifier = await AdminUpgradeabilityProxy.new(certifier.address, owner, []);
        certifier = await Certifier.at(certifier.address);
      }
      // Deploy KeyGenHistory contract
      keyGenHistory = await KeyGenHistory.new();
      if (useUpgradeProxy) {
        keyGenHistory = await AdminUpgradeabilityProxy.new(keyGenHistory.address, owner, []);
        keyGenHistory = await KeyGenHistory.at(keyGenHistory.address);
      }

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

    it('Deploy Initializer', async () => {

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
        contractAddresses,
        owner, // _owner
        initializingMiningAddresses, // _miningAddresses
        initializingStakingAddresses, // _stakingAddresses
        stakingParams,
        publicKeys,
        initialValidatorsIpAddresses,
        parts,
        acks);

      const validators = await validatorSetHbbft.getValidators.call();

      validators.should.be.deep.equal(initializingMiningAddresses);

      //debug set the current timestamp to 1, so it is not causing problems.
      await validatorSetHbbft.setCurrentTimestamp(new BN('1'));

      //candidateMinStake = await stakingHbbft.candidateMinStake.call();
      //delegatorMinStake = await stakingHbbft.delegatorMinStake.call();


    })

    it('failed KeyGeneration, availability.', async () => {

      // console.log('start failed key gen');
      // await timeTravelToTransition();
      // console.log('transition OK');
      // await timeTravelToEndEpoch();
      // console.log('end epoch');

      const stakingBanned = await validatorSetHbbft.bannedUntil.call(stakingAddresses[0]);
      const miningBanned = await validatorSetHbbft.bannedUntil.call(miningAddresses[0]);
      const currentTS = await validatorSetHbbft.getCurrentTimestamp.call();
      const newPoolStakingAddress = stakingAddresses[4];
      const newPoolMiningAddress = miningAddresses[4];

      if (logOutput) {
        console.log('stakingBanned?', stakingBanned);
        console.log('miningBanned?', miningBanned);
        console.log('currentTS:', currentTS);
        console.log('newPoolStakingAddress:', newPoolStakingAddress);
        console.log('newPoolMiningAddress:', newPoolMiningAddress);
      }

      false.should.be.equal(await stakingHbbft.isPoolActive.call(newPoolStakingAddress));

      await stakingHbbft.addPool(newPoolMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
        '0x00000000000000000000000000000000', { from: newPoolStakingAddress, value: candidateMinStake }).should.be.fulfilled;

      //await stakingHbbft.addPool(miningAddresses[5], '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      //'0x00000000000000000000000000000000', {from: stakingAddresses[5], value: candidateMinStake}).should.be.fulfilled;

      const poolIsActiveNow = await stakingHbbft.isPoolActive.call(newPoolStakingAddress);
      poolIsActiveNow.should.be.equal(true);
      
      //await stakingHbbft.stake(stakingAddresses[0], {from: stakingAddresses[0], value: candidateMinStake}).should.be.fulfilled;
      //await stakingHbbft.stake(stakingAddresses[1], {from: stakingAddresses[1], value: candidateMinStake}).should.be.fulfilled;
      //await stakingHbbft.stake(stakingAddresses[2], {from: stakingAddresses[2], value: candidateMinStake}).should.be.fulfilled;



      await printValidatorState('after staking on new Pool:');
      await timeTravelToTransition();
      await printValidatorState('after travel to transition:');

      // let isPending = await validatorSetHbbft.isPendingValidator.call(miningAddresses[0]);
      // console.log('isPending?', isPending);

      // let validators = await validatorSetHbbft.getValidators.call();
      // console.log('validators while pending: ', validators);

      await timeTravelToEndEpoch();

      // the pools did not manage to write it's part and acks.
      // 

      await printValidatorState('after failure:');

      (await stakingHbbft.getPoolsToBeElected.call()).should.be.deep.equal([]);
      (await stakingHbbft.getPoolsInactive.call()).should.be.deep.equal([newPoolStakingAddress]);

      // pending validators still should not have changed, since we dit not call end block.
      // WIP: this test currently failes. one of the initial validators takes over the list of pending validators
      // what should it be anyway ? the original validators ?
      // they are gone :-o
      //(await validatorSetHbbft.getPendingValidators.call()).should.be.deep.equal([]);

      
      // announcing availability.
      // this should place us back on the list of active and available pools.
      await announceAvailability(newPoolMiningAddress);
      

      await printValidatorState('after announceAvailability:');

      // pool is available again!
      (await stakingHbbft.getPoolsToBeElected.call()).should.be.deep.equal([newPoolStakingAddress]);
      (await stakingHbbft.getPoolsInactive.call()).should.be.deep.equal([]);


      // the original validators took over.
      // lets travel again to the end of the epoch, to switch into the next epoch
      // to invoke another voting.

      //write the PART and ACK for the pending validator:

      const pendingValidators = await validatorSetHbbft.getPendingValidators.call();

      pendingValidators.should.be.deep.equal([initializingMiningAddresses[0]]);

      await writePart('1', parts[0], pendingValidators[0]);

      //confirm that part was written.
      const partFromBc = await keyGenHistory.getPart.call(pendingValidators[0]);
      partFromBc.should.be.equal('0x' + parts[0].toString('hex'), partFromBc, 'parts read from the blockchain require to be equal to the written data.');

      await writeAcks('1', acks[0], pendingValidators[0]);

      await timeTravelToEndEpoch();

      let epoch = (await stakingHbbft.stakingEpoch.call());

      await printValidatorState('epoch1 start:');

      epoch.should.be.bignumber.equal(new BN('1'));


      await timeTravelToTransition();

      await printValidatorState('epoch1 phase2:');

      // // now write the ACK and the PART:
      await writePart('2', parts[0], newPoolMiningAddress);
      await writeAcks('2', acks[0], newPoolMiningAddress );

      // it's now job of the current validators to verify the correct write of the PARTS and ACKS
      // (this is simulated by the next call)
      await timeTravelToEndEpoch();

      // now everything is fine, we can do the transition after failing 
      // the first one.

      epoch = (await stakingHbbft.stakingEpoch.call());
      await printValidatorState('epoch2 start:');
      epoch.should.be.bignumber.equal(new BN('2'));

      // // now the new node should be a validator.
      (await validatorSetHbbft.getValidators.call()).should.be.deep.equal([newPoolMiningAddress]);

    });

    it('1/2 KeyGeneration - PART Failure', async () => {
      //tests  a 2 validators setup.
      // 1 manages to write it's part.
      // 1 does not manage to write it's part.
      // expected behavior:
      // system goes into an extra key gen round,
      // without the failing party as pending validator.
      // even if the failing party manages to announce availability
      // within the extra-key-gen round he wont be picked up this round.

      const poolStakingAddress1 = stakingAddresses[4];
      const poolMiningAddress1 = miningAddresses[4];

      // address1 is already picked up and a validator.
      // we double check if he is also marked for being available:

      let validatorAvailableSince = await validatorSetHbbft.validatorAvailableSince.call(poolMiningAddress1);
      validatorAvailableSince.should.not.be.bignumber.equal(new BN('0'));

      const poolStakingAddress2 = stakingAddresses[5];
      const poolMiningAddress2 = miningAddresses[5];

      await stakingHbbft.addPool(poolMiningAddress2, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
        '0x00000000000000000000000000000000', { from: poolStakingAddress2, value: candidateMinStake }).should.be.fulfilled;

      await printValidatorState('After adding mining address2:');
      await timeTravelToTransition();
      await printValidatorState('validator2 pending:');

      // now let pending validator 2 write it's Part,
      // but pending validator 1 misses out to write it's part.

      await writePart('3', parts[0], poolMiningAddress2);


      await writeAcks('3', acks[0], poolMiningAddress2).should.be.rejected;

      if (logOutput) {
        console.log('numberOfPartsWritten: ',  await keyGenHistory.numberOfPartsWritten.call());
        console.log('numberOfAcksWritten: ',  await keyGenHistory.numberOfAcksWritten.call());
      }
      

      await timeTravelToEndEpoch();

      await printValidatorState('failedEnd:');

      // another TimeTravel to end epoch happened,
      // we expect that there was NO epoch change.
      // since Validator 1 failed writing his keys.
      let epoch = (await stakingHbbft.stakingEpoch.call());
      epoch.should.be.bignumber.equal(new BN('2'));

      // we expect Validator 1 now to be marked as unavailable,
      // since he failed to write his key.
      validatorAvailableSince = await validatorSetHbbft.validatorAvailableSince.call(poolMiningAddress1);
      validatorAvailableSince.should.be.bignumber.equal(new BN('0'));

      // and only validator 2 is part of the Set.
      // validator 2 needs to write his keys again.
      const pendingValidators = await validatorSetHbbft.getPendingValidators.call();
      pendingValidators.should.be.deep.equal([poolMiningAddress2]);

    });
  }); // describe

}); // contract


async function printValidatorState(info) {

  if (!logOutput) {
    return;
  }
  const validators = await validatorSetHbbft.getValidators.call();
  const pendingValidators = await validatorSetHbbft.getPendingValidators.call();

  //Note: toBeElected are Pool (staking) addresses, and not Mining adresses. 
  // all other adresses are mining adresses.
  const toBeElected = await stakingHbbft.getPoolsToBeElected.call();
  const pools = await stakingHbbft.getPools.call();
  const poolsInactive = await stakingHbbft.getPoolsInactive.call();
  const epoch = await stakingHbbft.stakingEpoch.call();

  console.log(info + ' epoch : ', epoch);
  console.log(info + ' pending   :', pendingValidators);
  console.log(info + ' validators:', validators);
  console.log(info + ' pools: ', pools);
  console.log(info + ' inactive pools: ', poolsInactive);
  console.log(info + ' pools toBeElected: ', toBeElected);
}

// checks if a validator is able to write parts for free
// and executes it.
// NOTE: It does not really send the transaction with 0 gas price, 
// because that would only work if the network nodes would already 
// run on the test contracts deployed here.
async function writePart(upcommingEpochNumber, parts, from) {

  await call2ParaFunction('writePart', from, upcommingEpochNumber, parts);
}

async function writeAcks(upcommingEpochNumber, parts, from) {
  await call2ParaFunction('writeAcks', from, upcommingEpochNumber, parts);
}

async function call2ParaFunction(functionName, from, upcommingEpochNumber, parts) {
  //
  const call = keyGenHistory.contract.methods[functionName](upcommingEpochNumber, parts);

  
  
  //(await txPermission._getSliceUInt256(5, keyGenHistory.contract.methods[functionName](upcommingEpochNumber.sub(new BN('1')), parts).encodeABI());


  const asEncoded = call.encodeABI();

  if (logOutput) {
    console.log('calling: ', functionName);
    console.log('from: ', from)
    console.log('epoch: ', upcommingEpochNumber.toString());
    console.log('ecodedCall: ', asEncoded);
  }
    
  //const numberFromContract = await txPermission._getSliceUInt256(4, asEncoded);
  //const numberFromContract2 = await txPermission._decodeUInt256Param(4, asEncoded);
  //console.log('upcommingEpochNumber: ', numberFromContract.toString());
  //console.log('numberFromContract2', numberFromContract2.toString());


  const allowedTxType = await txPermission.allowedTxTypes(from, keyGenHistory.address, '0x0' /* value */, '0x0' /* gas price */, asEncoded);

  //console.log(allowedTxType.typesMask.toString());
  // don't ask to cache this result.
  allowedTxType.cache.should.be.equal(false);

  /// 0x01 - basic transaction (e.g. ether transferring to user wallet);
  /// 0x02 - contract call;
  /// 0x04 - contract creation;
  /// 0x08 - private transaction.

  allowedTxType.typesMask.should.be.bignumber.equal(new BN('2'), 'Transaction should be allowed according to TxPermission Contract.');
  
  // we know now, that this call is allowed. 
  // so we can execute it.
  await call.send({ from, gas: '7000000' });
}

async function announceAvailability( pool ) {

  const call = validatorSetHbbft.contract.methods.announceAvailability();

  const asEncoded = call.encodeABI();

  if (logOutput) {
    console.log('calling: announceAvailability');
    console.log('pool: ', pool)
    console.log('ecodedCall: ', asEncoded);
  }

  const allowedTxType = await txPermission.allowedTxTypes(pool, validatorSetHbbft.address, '0x0' /* value */, '0x0' /* gas price */, asEncoded);

  //console.log(allowedTxType.typesMask.toString());
  // don't ask to cache this result.
  allowedTxType.cache.should.be.equal(false);

  /// 0x01 - basic transaction (e.g. ether transferring to user wallet);
  /// 0x02 - contract call;
  /// 0x04 - contract creation;
  /// 0x08 - private transaction.

  allowedTxType.typesMask.should.be.bignumber.equal(new BN('2'), 'Transaction should be allowed according to TxPermission Contract.');

  // we know now, that this call is allowed. 
  // so we can execute it.
  await call.send({ from: pool, gas: '7000000' });

}

async function callReward(isEpochEndBlock) {
  // console.log('getting validators...');
  // note: this call used to crash because of a internal problem with a previous call of evm_mine and evm_increase_time https://github.com/DMDcoin/hbbft-posdao-contracts/issues/13 
  // console.log('got validators:', validators);
  await blockRewardHbbft.setSystemAddress(owner).should.be.fulfilled;
  await blockRewardHbbft.reward(isEpochEndBlock, { from: owner }).should.be.fulfilled;
  await blockRewardHbbft.setSystemAddress('0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE').should.be.fulfilled;

}

//time travels forward to the beginning of the next transition,
//and simulate a block mining (calling reward())
async function timeTravelToTransition() {

  let startTimeOfNextPhaseTransition = await stakingHbbft.startTimeOfNextPhaseTransition.call();
  await validatorSetHbbft.setCurrentTimestamp(startTimeOfNextPhaseTransition);
  const currentTS = await validatorSetHbbft.getCurrentTimestamp.call();
  currentTS.should.be.bignumber.equal(startTimeOfNextPhaseTransition);
  await callReward(false);
}

async function timeTravelToEndEpoch() {

  // todo: mimic the behavor of the nodes here:
  // if The Validators managed to write the correct number 
  // of Acks and Parts, we are happy and set a "true"
  // if not, we send a "false"
  // note: the Nodes they DO check if the ACKS and PARTS
  // make it possible to generate a treshold key here,
  // but within the tests, we just mimic this behavior.
  const callResult = await keyGenHistory.getNumberOfKeyFragmentsWritten.call();

  const numberOfParts = callResult['0'].toNumber();
  const numberOfAcks = callResult['1'].toNumber();

  const pendingValidators = await validatorSetHbbft.getPendingValidators.call();
  const numberOfPendingValidators = pendingValidators.length;
  let callRewardParameter = (numberOfParts === numberOfPendingValidators && numberOfAcks === numberOfPendingValidators);

  const endTimeOfCurrentEpoch = await stakingHbbft.stakingFixedEpochEndTime.call();
  await validatorSetHbbft.setCurrentTimestamp(endTimeOfCurrentEpoch);
  await callReward(callRewardParameter);
}
