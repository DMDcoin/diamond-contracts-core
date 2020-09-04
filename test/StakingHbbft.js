const BlockRewardHbbft = artifacts.require('BlockRewardHbbftCoinsMock');
const AdminUpgradeabilityProxy = artifacts.require('AdminUpgradeabilityProxy');
const RandomHbbft = artifacts.require('RandomHbbftMock');
const ValidatorSetHbbft = artifacts.require('ValidatorSetHbbftMock');
const StakingHbbftCoins = artifacts.require('StakingHbbftCoinsMock');
const KeyGenHistory = artifacts.require('KeyGenHistory');

const ERROR_MSG = 'VM Exception while processing transaction: revert';
const BN = web3.utils.BN;

const fp = require('lodash/fp');
require('chai')
  .use(require('chai-as-promised'))
  .use(require('chai-bn')(BN))
  .should();

let currentAccounts;

contract('StakingHbbft', async accounts => {

  

  let owner;
  let initialValidators;
  let initialStakingAddresses;
  let blockRewardHbbft;
  let randomHbbft;
  let stakingHbbft;
  let validatorSetHbbft;
  let initialValidatorsPubKeys;
  let initialValidatorsPubKeysSplit;
  let initialValidatorsIpAddresses;

  currentAccounts = accounts;
  const minStake = new BN(web3.utils.toWei('1', 'ether'));
  const maxEpochReward = new BN(100); // the maximum  per-block reward distributed to the validators
  const stakingFixedEpochDuration = new BN(2);
  const stakingWithdrawDisallowPeriod = new BN(1);
  //const stakingEpochStartBlock = new BN(0);
  const keyGenerationDuration = new BN(2); // we assume that there is a fixed duration in blocks, in reality it varies.

  beforeEach(async () => {
    owner = accounts[0];
    initialValidators = accounts.slice(1, 3 + 1); // accounts[1...3]
    initialStakingAddresses = accounts.slice(4, 6 + 1); // accounts[4...6]
    initialStakingAddresses.length.should.be.equal(3);
    initialStakingAddresses[0].should.not.be.equal('0x0000000000000000000000000000000000000000');
    initialStakingAddresses[1].should.not.be.equal('0x0000000000000000000000000000000000000000');
    initialStakingAddresses[2].should.not.be.equal('0x0000000000000000000000000000000000000000');
    // Deploy BlockReward contract
    blockRewardHbbft = await BlockRewardHbbft.new();
    blockRewardHbbft = await AdminUpgradeabilityProxy.new(blockRewardHbbft.address, owner, []);
    blockRewardHbbft = await BlockRewardHbbft.at(blockRewardHbbft.address);
    // Deploy Random contract
    randomHbbft = await RandomHbbft.new();
    randomHbbft = await AdminUpgradeabilityProxy.new(randomHbbft.address, owner, []);
    randomHbbft = await RandomHbbft.at(randomHbbft.address);
    // Deploy Staking contract
    stakingHbbft = await StakingHbbftCoins.new();
    stakingHbbft = await AdminUpgradeabilityProxy.new(stakingHbbft.address, owner, []);
    stakingHbbft = await StakingHbbftCoins.at(stakingHbbft.address);
    // Deploy ValidatorSet contract
    validatorSetHbbft = await ValidatorSetHbbft.new();
    validatorSetHbbft = await AdminUpgradeabilityProxy.new(validatorSetHbbft.address, owner, []);
    validatorSetHbbft = await ValidatorSetHbbft.at(validatorSetHbbft.address);

    increaseTime(1);

    keyGenHistory = await KeyGenHistory.new();
    keyGenHistory = await AdminUpgradeabilityProxy.new(keyGenHistory.address, owner, []);
    keyGenHistory = await KeyGenHistory.at(keyGenHistory.address);

    await keyGenHistory.initialize(validatorSetHbbft.address, initialValidators, [[0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,181,129,31,84,186,242,5,151,59,35,196,140,106,29,40,112,142,156,132,158,47,223,253,185,227,249,190,96,5,99,239,213,127,29,136,115,71,164,202,44,6,171,131,251,147,159,54,49,1,0,0,0,0,0,0,0,153,0,0,0,0,0,0,0,4,177,133,61,18,58,222,74,65,5,126,253,181,113,165,43,141,56,226,132,208,218,197,119,179,128,30,162,251,23,33,73,38,120,246,223,233,11,104,60,154,241,182,147,219,81,45,134,239,69,169,198,188,152,95,254,170,108,60,166,107,254,204,195,170,234,154,134,26,91,9,139,174,178,248,60,65,196,218,46,163,218,72,1,98,12,109,186,152,148,159,121,254,34,112,51,70,121,51,167,35,240,5,134,197,125,252,3,213,84,70,176,160,36,73,140,104,92,117,184,80,26,240,106,230,241,26,79,46,241,195,20,106,12,186,49,254,168,233,25,179,96,62,104,118,153,95,53,127,160,237,246,41],[0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,181,129,31,84,186,242,5,151,59,35,196,140,106,29,40,112,142,156,132,158,47,223,253,185,227,249,190,96,5,99,239,213,127,29,136,115,71,164,202,44,6,171,131,251,147,159,54,49,1,0,0,0,0,0,0,0,153,0,0,0,0,0,0,0,4,177,133,61,18,58,222,74,65,5,126,253,181,113,165,43,141,56,226,132,208,218,197,119,179,128,30,162,251,23,33,73,38,120,246,223,233,11,104,60,154,241,182,147,219,81,45,134,239,69,169,198,188,152,95,254,170,108,60,166,107,254,204,195,170,234,154,134,26,91,9,139,174,178,248,60,65,196,218,46,163,218,72,1,98,12,109,186,152,148,159,121,254,34,112,51,70,121,51,167,35,240,5,134,197,125,252,3,213,84,70,176,160,36,73,140,104,92,117,184,80,26,240,106,230,241,26,79,46,241,195,20,106,12,186,49,254,168,233,25,179,96,62,104,118,153,95,53,127,160,237,246,41],[0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,181,129,31,84,186,242,5,151,59,35,196,140,106,29,40,112,142,156,132,158,47,223,253,185,227,249,190,96,5,99,239,213,127,29,136,115,71,164,202,44,6,171,131,251,147,159,54,49,1,0,0,0,0,0,0,0,153,0,0,0,0,0,0,0,4,177,133,61,18,58,222,74,65,5,126,253,181,113,165,43,141,56,226,132,208,218,197,119,179,128,30,162,251,23,33,73,38,120,246,223,233,11,104,60,154,241,182,147,219,81,45,134,239,69,169,198,188,152,95,254,170,108,60,166,107,254,204,195,170,234,154,134,26,91,9,139,174,178,248,60,65,196,218,46,163,218,72,1,98,12,109,186,152,148,159,121,254,34,112,51,70,121,51,167,35,240,5,134,197,125,252,3,213,84,70,176,160,36,73,140,104,92,117,184,80,26,240,106,230,241,26,79,46,241,195,20,106,12,186,49,254,168,233,25,179,96,62,104,118,153,95,53,127,160,237,246,41]],
      [[[0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,145,0,0,0,0,0,0,0,4,239,1,112,13,13,251,103,186,212,78,44,47,250,221,84,118,88,7,64,206,186,11,2,8,204,140,106,179,52,251,237,19,53,74,187,217,134,94,66,68,89,42,85,207,155,220,101,223,51,199,37,38,203,132,13,77,78,114,53,219,114,93,21,25,164,12,43,252,160,16,23,111,79,230,121,95,223,174,211,172,231,0,52,25,49,152,79,128,39,117,216,85,201,237,242,151,219,149,214,77,233,145,47,10,184,175,162,174,237,177,131,45,126,231,32,147,227,170,125,133,36,123,164,232,129,135,196,136,186,45,73,226,179,169,147,42,41,140,202,191,12,73,146,2]],[[0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,145,0,0,0,0,0,0,0,4,239,1,112,13,13,251,103,186,212,78,44,47,250,221,84,118,88,7,64,206,186,11,2,8,204,140,106,179,52,251,237,19,53,74,187,217,134,94,66,68,89,42,85,207,155,220,101,223,51,199,37,38,203,132,13,77,78,114,53,219,114,93,21,25,164,12,43,252,160,16,23,111,79,230,121,95,223,174,211,172,231,0,52,25,49,152,79,128,39,117,216,85,201,237,242,151,219,149,214,77,233,145,47,10,184,175,162,174,237,177,131,45,126,231,32,147,227,170,125,133,36,123,164,232,129,135,196,136,186,45,73,226,179,169,147,42,41,140,202,191,12,73,146,2]],[[0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,145,0,0,0,0,0,0,0,4,239,1,112,13,13,251,103,186,212,78,44,47,250,221,84,118,88,7,64,206,186,11,2,8,204,140,106,179,52,251,237,19,53,74,187,217,134,94,66,68,89,42,85,207,155,220,101,223,51,199,37,38,203,132,13,77,78,114,53,219,114,93,21,25,164,12,43,252,160,16,23,111,79,230,121,95,223,174,211,172,231,0,52,25,49,152,79,128,39,117,216,85,201,237,242,151,219,149,214,77,233,145,47,10,184,175,162,174,237,177,131,45,126,231,32,147,227,170,125,133,36,123,164,232,129,135,196,136,186,45,73,226,179,169,147,42,41,140,202,191,12,73,146,2]]]
      ).should.be.fulfilled;

    // Initialize ValidatorSet
    await validatorSetHbbft.initialize(
      blockRewardHbbft.address, // _blockRewardContract
      randomHbbft.address, // _randomContract
      stakingHbbft.address, // _stakingContract
      keyGenHistory.address, //_keyGenHistoryContract
      initialValidators, // _initialMiningAddresses
      initialStakingAddresses, // _initialStakingAddresses
    ).should.be.fulfilled;

    // The following private keys belong to the accounts 1-3, fixed by using the "--mnemonic" option when starting ganache.
    // const initialValidatorsPrivKeys = ["0x272b8400a202c08e23641b53368d603e5fec5c13ea2f438bce291f7be63a02a7", "0xa8ea110ffc8fe68a069c8a460ad6b9698b09e21ad5503285f633b3ad79076cf7", "0x5da461ff1378256f69cb9a9d0a8b370c97c460acbe88f5d897cb17209f891ffc"];
    // Public keys corresponding to the three private keys above.
    initialValidatorsPubKeys = ['0x52be8f332b0404dff35dd0b2ba44993a9d3dc8e770b9ce19a849dff948f1e14c57e7c8219d522c1a4cce775adbee5330f222520f0afdabfdb4a4501ceeb8dcee',
      '0x99edf3f524a6f73e7f5d561d0030fc6bcc3e4bd33971715617de7791e12d9bdf6258fa65b74e7161bbbf7ab36161260f56f68336a6f65599dc37e7f2e397f845',
      '0xa255fd7ad199f0ee814ee00cce44ef2b1fa1b52eead5d8013ed85eade03034ae4c246658946c2e1d7ded96394a1247fb4d093c32474317ae388e8d25692a0f56'];
    initialValidatorsPubKeysSplit = fp.flatMap(x => [x.substring(0, 66), '0x' + x.substring(66, 130)])
      (initialValidatorsPubKeys);
    // The IP addresses are irrelevant for these unit test, just initialize them to 0.
    initialValidatorsIpAddresses = ['0x00000000000000000000000000000000', '0x00000000000000000000000000000000', '0x00000000000000000000000000000000'];
    
  });

  describe('addPool()', async () => {
    let candidateMiningAddress;
    let candidateStakingAddress;

    beforeEach(async () => {
      candidateMiningAddress = accounts[7];
      candidateStakingAddress = accounts[8];

      // Initialize StakingHbbft
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        minStake, // _delegatorMinStake
        minStake, // _candidateMinStake
        stakingFixedEpochDuration, // _stakingFixedEpochDuration
        stakingWithdrawDisallowPeriod, // _stakingWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.fulfilled;

      // Emulate block number
      increaseTime(2);
      //await stakingHbbft.setCurrentBlockNumber(2).should.be.fulfilled;
      //await validatorSetHbbft.setCurrentBlockNumber(2).should.be.fulfilled;
    });
    it('should set the corresponding public keys', async () => {
      for (let i = 0; i < initialStakingAddresses.length; i++) {
          (await stakingHbbft.getPoolPublicKey.call(initialStakingAddresses[i])).should.be.deep.equal(initialValidatorsPubKeys[i]);
      }
    });
    it('should set the corresponding IP addresses', async () => {
      for (let i = 0; i < initialStakingAddresses.length; i++) {
          (await stakingHbbft.getPoolInternetAddress.call(initialStakingAddresses[i])).should.be.deep.equal(initialValidatorsIpAddresses[i]);
      }
    });
    it('should create a new pool', async () => {
      false.should.be.equal(await stakingHbbft.isPoolActive.call(candidateStakingAddress));
      await increaseTime(2);
      await stakingHbbft.addPool(candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress, value: minStake}).should.be.fulfilled;
      true.should.be.equal(await stakingHbbft.isPoolActive.call(candidateStakingAddress));
    });
    it('should fail if mining address is 0', async () => {
      await stakingHbbft.addPool('0x0000000000000000000000000000000000000000', '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress, value: minStake}).should.be.rejectedWith("Mining address can't be 0");
    });
    it('should fail if mining address is equal to staking', async () => {
      await stakingHbbft.addPool(candidateStakingAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress, value: minStake}).should.be.rejectedWith("Mining address cannot be the same as the staking one");
    });
    it('should fail if the pool with the same mining/staking address is already existing', async () => {
      const candidateMiningAddress2 = accounts[9];
      const candidateStakingAddress2 = accounts[10];

      await increaseTime(2);

      await stakingHbbft.addPool(candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress, value: minStake}).should.be.fulfilled;

      await stakingHbbft.addPool(candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress2, value: minStake}).should.be.rejectedWith("Mining address already used as a mining one");
      await stakingHbbft.addPool(candidateMiningAddress2, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress, value: minStake}).should.be.rejectedWith("Staking address already used as a staking one");

      await stakingHbbft.addPool(candidateStakingAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateMiningAddress2, value: minStake}).should.be.rejectedWith("Mining address already used as a staking one");
      await stakingHbbft.addPool(candidateStakingAddress2, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateMiningAddress, value: minStake}).should.be.rejectedWith("Staking address already used as a mining one");

      await stakingHbbft.addPool(candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000',{from: candidateMiningAddress2, value: minStake}).should.be.rejectedWith("Mining address already used as a mining one");
      await stakingHbbft.addPool(candidateMiningAddress2, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateMiningAddress, value: minStake}).should.be.rejectedWith("Staking address already used as a mining one");

      await stakingHbbft.addPool(candidateStakingAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress2, value: minStake}).should.be.rejectedWith("Mining address already used as a staking one");
      await stakingHbbft.addPool(candidateStakingAddress2, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress, value: minStake}).should.be.rejectedWith("Staking address already used as a staking one");

      await stakingHbbft.addPool(candidateMiningAddress2, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress2, value: minStake}).should.be.fulfilled;
    });
    it('should fail if gasPrice is 0', async () => {
      await stakingHbbft.addPool(candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress, gasPrice: 0, value: minStake}).should.be.rejectedWith("GasPrice is 0");
    });
    it('should fail if staking amount is 0', async () => {
      await stakingHbbft.addPool(candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress, value: new BN(0)}).should.be.rejectedWith("Stake: stakingAmount is 0");
    });
    // it('should fail if stacking time is inside disallowed range', async () => {
    //   //await stakingHbbft.setCurrentBlockNumber(119960).should.be.fulfilled;
    //   //await validatorSetHbbft.setCurrentBlockNumber(119960).should.be.fulfilled;
    //   await stakingHbbft.addPool(candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    //   '0x00000000000000000000000000000000', {from: candidateStakingAddress, value: minStake}).should.be.rejectedWith("Stake: disallowed period");
    //   //await stakingHbbft.setCurrentBlockNumber(116560).should.be.fulfilled;
    //   //await validatorSetHbbft.setCurrentBlockNumber(116560).should.be.fulfilled;
    //   await increaseTime(2);
    //   await stakingHbbft.addPool(candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    //   '0x00000000000000000000000000000000', {from: candidateStakingAddress, value: minStake}).should.be.fulfilled;
    // });
    it('should fail if staking amount is less than CANDIDATE_MIN_STAKE', async () => {
      await stakingHbbft.addPool(candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress, value: minStake.div(new BN(2))}).should.be.rejectedWith("Stake: candidateStake less than candidateMinStake");
    });
    it('stake amount should be increased', async () => {
      const amount = minStake.mul(new BN(2));
      await stakingHbbft.addPool(candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress, value: amount}).should.be.fulfilled;
      amount.should.be.bignumber.equal(await stakingHbbft.stakeAmount.call(candidateStakingAddress, candidateStakingAddress));
      amount.should.be.bignumber.equal(await stakingHbbft.stakeAmountByCurrentEpoch.call(candidateStakingAddress, candidateStakingAddress));
      amount.should.be.bignumber.equal(await stakingHbbft.stakeAmountTotal.call(candidateStakingAddress));
    });
    it('should be able to add more than one pool', async () => {
      const candidate1MiningAddress = candidateMiningAddress;
      const candidate1StakingAddress = candidateStakingAddress;
      const candidate2MiningAddress = accounts[9];
      const candidate2StakingAddress = accounts[10];
      const amount1 = minStake.mul(new BN(2));
      const amount2 = minStake.mul(new BN(3));

      // Add two new pools
      (await stakingHbbft.isPoolActive.call(candidate1StakingAddress)).should.be.equal(false);
      (await stakingHbbft.isPoolActive.call(candidate2StakingAddress)).should.be.equal(false);
      await stakingHbbft.addPool(candidate1MiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidate1StakingAddress, value: amount1}).should.be.fulfilled;
      await stakingHbbft.addPool(candidate2MiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidate2StakingAddress, value: amount2}).should.be.fulfilled;
      (await stakingHbbft.isPoolActive.call(candidate1StakingAddress)).should.be.equal(true);
      (await stakingHbbft.isPoolActive.call(candidate2StakingAddress)).should.be.equal(true);

      // Check indexes (0...2 are busy by initial validators)
      new BN(3).should.be.bignumber.equal(await stakingHbbft.poolIndex.call(candidate1StakingAddress));
      new BN(4).should.be.bignumber.equal(await stakingHbbft.poolIndex.call(candidate2StakingAddress));

      // Check indexes in the `poolsToBeElected` list
      new BN(0).should.be.bignumber.equal(await stakingHbbft.poolToBeElectedIndex.call(candidate1StakingAddress));
      new BN(1).should.be.bignumber.equal(await stakingHbbft.poolToBeElectedIndex.call(candidate2StakingAddress));

      // Check pools' existence
      const validators = await validatorSetHbbft.getValidators.call();

      (await stakingHbbft.getPools.call()).should.be.deep.equal([
        await validatorSetHbbft.stakingByMiningAddress.call(validators[0]),
        await validatorSetHbbft.stakingByMiningAddress.call(validators[1]),
        await validatorSetHbbft.stakingByMiningAddress.call(validators[2]),
        candidate1StakingAddress,
        candidate2StakingAddress
      ]);
    });
    it('shouldn\'t allow adding more than MAX_CANDIDATES pools', async () => {
      for (let p = initialValidators.length; p < 100; p++) {
        // Generate new candidate staking address
        let candidateStakingAddress = '0x';
        for (let i = 0; i < 20; i++) {
          let randomByte = random(0, 255).toString(16);
          if (randomByte.length % 2) {
            randomByte = '0' + randomByte;
          }
          candidateStakingAddress += randomByte;
        }

        // Add a new pool
        await stakingHbbft.addPoolActiveMock(candidateStakingAddress).should.be.fulfilled;
        new BN(p).should.be.bignumber.equal(await stakingHbbft.poolIndex.call(candidateStakingAddress));
      }

      // Try to add a new pool outside of max limit, max limit is 100 in mock contract.
      await stakingHbbft.addPool(candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress, value: minStake}).should.be.rejectedWith("MAX_CANDIDATES pools exceeded");
      false.should.be.equal(await stakingHbbft.isPoolActive.call(candidateStakingAddress));
    });
    it('should remove added pool from the list of inactive pools', async () => {
      await stakingHbbft.addPoolInactiveMock(candidateStakingAddress).should.be.fulfilled;
      (await stakingHbbft.getPoolsInactive.call()).should.be.deep.equal([candidateStakingAddress]);
      await stakingHbbft.addPool(candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress, value: minStake}).should.be.fulfilled;
      true.should.be.equal(await stakingHbbft.isPoolActive.call(candidateStakingAddress));
      (await stakingHbbft.getPoolsInactive.call()).length.should.be.equal(0);
    });
  });

  describe('contract balance', async () => {

    beforeEach(async () => {
      candidateMiningAddress = accounts[7];
      candidateStakingAddress = accounts[8];

      // Initialize StakingHbbft
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        minStake, // _delegatorMinStake
        minStake, // _candidateMinStake
        stakingFixedEpochDuration, // _stakingFixedEpochDuration
        stakingWithdrawDisallowPeriod, // _stakingWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.fulfilled;

      // Emulate block number
      //await stakingHbbft.setCurrentBlockNumber(2).should.be.fulfilled;
      //await validatorSetHbbft.setCurrentBlockNumber(2).should.be.fulfilled;
    });

    it('cannot be increased by sending native coins', async () => {
      await web3.eth.sendTransaction({from: owner, to: stakingHbbft.address, value: 1}).should.be.rejectedWith("Not payable");
      await web3.eth.sendTransaction({from: owner, to: accounts[1], value: 1}).should.be.fulfilled; 
      (await web3.eth.getBalance(stakingHbbft.address)).should.be.equal('0');
    });

    it('can be increased by sending coins to payable functions', async () => {
      (await web3.eth.getBalance(stakingHbbft.address)).should.be.equal('0');
      await stakingHbbft.addPool(candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress, value: minStake}).should.be.fulfilled;
      (new BN(await web3.eth.getBalance(stakingHbbft.address))).should.be.bignumber.equal(minStake);
      await stakingHbbft.stake(candidateStakingAddress, {from: candidateStakingAddress, value: minStake}).should.be.fulfilled;
      (new BN(await web3.eth.getBalance(stakingHbbft.address))).should.be.bignumber.equal(minStake.mul(new BN(2)));
    });

  });

  describe('claimReward()', async () => {
    let delegator;
    let delegatorMinStake;

    beforeEach(async () => {

      //console.log('calling before each claimReward()');

      // Initialize BlockRewardHbbft
      await blockRewardHbbft.initialize(
        validatorSetHbbft.address,
        maxEpochReward
      ).should.be.fulfilled;

      // Initialize RandomHbbft
      await randomHbbft.initialize(
        validatorSetHbbft.address
      ).should.be.fulfilled;

      // Initialize StakingHbbft
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        minStake, // _delegatorMinStake
        minStake, // _candidateMinStake
        stakingFixedEpochDuration, // _stakingFixedEpochDuration
        stakingWithdrawDisallowPeriod, // _stakingWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.fulfilled;

      // Genesis block: start the network
      //await setCurrentBlockNumber(0);
      //(await validatorSetHbbft.getCurrentBlockNumber.call()).should.be.bignumber.equal(new BN(0));
      //(await stakingHbbft.getCurrentBlockNumber.call()).should.be.bignumber.equal(new BN(0));
      await callFinalizeChange();

      // Staking epoch #0 starts on block #1
      (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(new BN(0));
      //(await stakingHbbft.stakingEpochStartBlock.call()).should.be.bignumber.equal(new BN(1));
      // await setCurrentBlockNumber(1);
      //(await validatorSetHbbft.getCurrentBlockNumber.call()).should.be.bignumber.equal(new BN(1));
      //(await stakingHbbft.getCurrentBlockNumber.call()).should.be.bignumber.equal(new BN(1));

      // Validators place stakes during the epoch #0
      const candidateMinStake = await stakingHbbft.candidateMinStake.call();
      for (let i = 0; i < initialStakingAddresses.length; i++) {
        // Validator places stake on themselves
        await stakingHbbft.stake(initialStakingAddresses[i], {from: initialStakingAddresses[i], value: candidateMinStake}).should.be.fulfilled;
      }

      // The delegator places stake on the first validator
      delegator = accounts[10];
      delegatorMinStake = await stakingHbbft.delegatorMinStake.call();
      await stakingHbbft.stake(initialStakingAddresses[0], {from: delegator, value: delegatorMinStake}).should.be.fulfilled;

      increaseTime(4);
      // Epoch's fixed duration ends
      //const stakingFixedEpochEndBlock = await stakingHbbft.stakingFixedEpochEndBlock.call();
      //await setCurrentBlockNumber(stakingFixedEpochEndBlock);
      await callReward(false);

      // the pending validator set should be updated
      (await validatorSetHbbft.getPendingValidators.call()).length.should.be.equal(3);

      // Staking epoch #0 finishes
      //const stakingEpochEndBlock = stakingFixedEpochEndBlock.add(keyGenerationDuration);
      //await setCurrentBlockNumber(stakingEpochEndBlock);

      await callReward(true);
    });

    async function _claimRewardStakeIncreasing(epochsPoolRewarded, epochsStakeIncreased) {
      const miningAddress = initialValidators[0];
      const stakingAddress = initialStakingAddresses[0];
      const epochPoolReward = new BN(web3.utils.toWei('1', 'ether'));
      const maxStakingEpoch = Math.max(Math.max.apply(null, epochsPoolRewarded), Math.max.apply(null, epochsStakeIncreased));

      (await web3.eth.getBalance(blockRewardHbbft.address)).should.be.equal('0');

      // Emulate rewards for the pool
      for (let i = 0; i < epochsPoolRewarded.length; i++) {
        const stakingEpoch = epochsPoolRewarded[i];
        await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, {value: epochPoolReward}).should.be.fulfilled;
      }

      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(epochPoolReward.mul(new BN(epochsPoolRewarded.length)));
      
      let prevStakingEpoch = 0;
      const validatorStakeAmount = await stakingHbbft.stakeAmount.call(stakingAddress, stakingAddress);
      let stakeAmount = await stakingHbbft.stakeAmount.call(stakingAddress, delegator);
      let stakeAmountOnEpoch = [new BN(0)];

      let s = 0;
      for (let epoch = 1; epoch <= maxStakingEpoch; epoch++) {
        const stakingEpoch = epochsStakeIncreased[s];

        if (stakingEpoch == epoch) {
          const startBlock = new BN(120954 * stakingEpoch + 1);
          await stakingHbbft.setStakingEpoch(stakingEpoch).should.be.fulfilled;
          await stakingHbbft.setValidatorSetAddress(owner).should.be.fulfilled;
          //await stakingHbbft.setStakingEpochStartBlock(startBlock).should.be.fulfilled;
          await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
          //await setCurrentBlockNumber(startBlock);

          // Emulate delegator's stake increasing
          await stakingHbbft.stake(stakingAddress, {from: delegator, value: delegatorMinStake}).should.be.fulfilled;

          for (let e = prevStakingEpoch + 1; e <= stakingEpoch; e++) {
            stakeAmountOnEpoch[e] = stakeAmount;
          }
          stakeAmount = await stakingHbbft.stakeAmount.call(stakingAddress, delegator);
          prevStakingEpoch = stakingEpoch;
          s++;
        }

        // Emulate snapshotting for the pool
        await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, epoch + 1, miningAddress).should.be.fulfilled;
      }

      const lastEpochRewarded = epochsPoolRewarded[epochsPoolRewarded.length - 1];
      await stakingHbbft.setStakingEpoch(lastEpochRewarded + 1).should.be.fulfilled;

      if (prevStakingEpoch < lastEpochRewarded) {
        for (let e = prevStakingEpoch + 1; e <= lastEpochRewarded; e++) {
          stakeAmountOnEpoch[e] = stakeAmount;
        }
      }

      let delegatorRewardExpected = new BN(0);
      let validatorRewardExpected = new BN(0);
      for (let i = 0; i < epochsPoolRewarded.length; i++) {
        const stakingEpoch = epochsPoolRewarded[i];
        await blockRewardHbbft.setValidatorMinRewardPercent(stakingEpoch, 30);
        const delegatorShare = await blockRewardHbbft.delegatorShare.call(
          stakingEpoch,
          stakeAmountOnEpoch[stakingEpoch],
          validatorStakeAmount,
          validatorStakeAmount.add(stakeAmountOnEpoch[stakingEpoch]),
          epochPoolReward
        );
        const validatorShare = await blockRewardHbbft.validatorShare.call(
          stakingEpoch,
          validatorStakeAmount,
          validatorStakeAmount.add(stakeAmountOnEpoch[stakingEpoch]),
          epochPoolReward
        );
        delegatorRewardExpected = delegatorRewardExpected.add(delegatorShare);
        validatorRewardExpected = validatorRewardExpected.add(validatorShare);
      }

      return {
        delegatorMinStake,
        miningAddress,
        stakingAddress,
        epochPoolReward,
        maxStakingEpoch,
        delegatorRewardExpected,
        validatorRewardExpected
      };
    }

    async function _delegatorNeverStakedBefore() {
      const miningAddress = initialValidators[0];
      const stakingAddress = initialStakingAddresses[0];
      const epochPoolReward = new BN(web3.utils.toWei('1', 'ether'));

      // Emulate the fact that the delegator never staked before
      // current block number is at the end of staking epoch #0
      // delegator orders a withdrawal during epoch #1
      //let stakingFixedEpochEndBlock = await stakingHbbft.stakingFixedEpochEndBlock.call();
      //let stakingEpochEndBlock = stakingFixedEpochEndBlock.add(keyGenerationDuration);
      //let stakingEpochStartBlock = stakingFixedEpochDuration.add(keyGenerationDuration).add(new BN(1));
      
      //let startBlock = stakingEpochEndBlock.add(new BN(1));
      //stakingEpochStartBlock.should.be.bignumber.equal(startBlock);
      
      // one block before new epoch, finalize change will increment it
      // finalize validators, increase stackingEpoch and set StakingEpochStartBlock
      await callFinalizeChange();
      (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(new BN(1));
      //stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
      //stakingEpochStartBlock.should.be.bignumber.equal(startBlock);
      // the pending validator set should be empy
      (await validatorSetHbbft.getPendingValidators.call()).length.should.be.equal(0);

      // Staking epoch #1: Start
      // await setCurrentBlockNumber(stakingEpochStartBlock);
      (await validatorSetHbbft.getValidators.call()).should.be.deep.equal(initialValidators);
      //increaseTime(4);
      (await stakingHbbft.areStakeAndWithdrawAllowed.call()).should.be.equal(true);
      await stakingHbbft.orderWithdraw(stakingAddress, delegatorMinStake, {from: delegator}).should.be.fulfilled;

      // Staking epoch #1: end of fixed duration
      //stakingFixedEpochEndBlock = await stakingHbbft.stakingFixedEpochEndBlock.call();
      //await setCurrentBlockNumber(stakingFixedEpochEndBlock);
      (await validatorSetHbbft.getPendingValidators.call()).length.should.be.equal(0);
      await callReward(false);
      // the pending validator set should be updated
      (await validatorSetHbbft.getPendingValidators.call()).length.should.be.equal(3);

      // Staking epoch #1: Epoch end block
      //let endBlock = stakingEpochStartBlock.add(stakingFixedEpochDuration).add(new BN(2)).sub(new BN(1)); // +2 for the keyGen duration
      //stakingEpochEndBlock = stakingFixedEpochEndBlock.add(keyGenerationDuration);
      //stakingEpochEndBlock.should.be.bignumber.equal(endBlock);
      //await setCurrentBlockNumber(stakingEpochEndBlock);

      // Staking epoch #1: Finalize change
      (await validatorSetHbbft.getPendingValidators.call()).length.should.be.equal(3);
      // upcoming epoch's start block
      startBlock = stakingFixedEpochDuration.add(keyGenerationDuration).mul(new BN(2)).add(new BN(1)); // (stakingFixedEpochDuration + keyGenerationDuration) * stakingEpoch + 1
      // finalize validators, increase stackingEpoch and set StakingEpochStartBlock
      await callFinalizeChange();
      (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(new BN(2));
      //stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock.call()
      //stakingEpochStartBlock.should.be.bignumber.equal(startBlock);
      // the pending validator set should be empty
      (await validatorSetHbbft.getPendingValidators.call()).length.should.be.equal(0);

      // epoch #2: the delegator withdraws their stake
      //await setCurrentBlockNumber(stakingEpochStartBlock);

      await stakingHbbft.claimOrderedWithdraw(stakingAddress, {from: delegator}).should.be.fulfilled;

      (await stakingHbbft.stakeAmount.call(stakingAddress, delegator)).should.be.bignumber.equal(new BN(0));
      (await stakingHbbft.orderedWithdrawAmount.call(stakingAddress, delegator)).should.be.bignumber.equal(new BN(0));
      (await stakingHbbft.stakeFirstEpoch.call(stakingAddress, delegator)).should.be.bignumber.equal(new BN(1));
      (await stakingHbbft.stakeLastEpoch.call(stakingAddress, delegator)).should.be.bignumber.equal(new BN(2));

      await stakingHbbft.setStakeFirstEpoch(stakingAddress, delegator, new BN(0)).should.be.fulfilled;
      await stakingHbbft.setStakeLastEpoch(stakingAddress, delegator, new BN(0)).should.be.fulfilled;
      await stakingHbbft.clearDelegatorStakeSnapshot(stakingAddress, delegator, new BN(1)).should.be.fulfilled;
      await stakingHbbft.clearDelegatorStakeSnapshot(stakingAddress, delegator, new BN(2)).should.be.fulfilled;

       // Staking epoch #2: end of fixed duration
       //stakingFixedEpochEndBlock = await stakingHbbft.stakingFixedEpochEndBlock.call();
       //await setCurrentBlockNumber(stakingFixedEpochEndBlock);
       await callReward(false);

      // Staking epoch #2: Epoch end block
      //endBlock = stakingEpochStartBlock.add(stakingFixedEpochDuration).add(new BN(2)).sub(new BN(1)); // +2 for the keyGen duration
      //stakingEpochEndBlock = (await stakingHbbft.stakingFixedEpochEndBlock.call()).add(keyGenerationDuration);
      //stakingEpochEndBlock.should.be.bignumber.equal(endBlock);
      //await setCurrentBlockNumber(stakingEpochEndBlock);
      await callReward(true);

      // Staking epoch #2: Finalize change
      await callFinalizeChange();
      (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(new BN(3));
      //(await stakingHbbft.stakingEpochStartBlock.call()).should.be.bignumber.equal(stakingEpochEndBlock.add(new BN(1)));
      return {miningAddress, stakingAddress, epochPoolReward};
    }

    async function testClaimRewardRandom(epochsPoolRewarded, epochsStakeIncreased) {
      const {
        delegatorMinStake,
        miningAddress,
        stakingAddress,
        epochPoolReward,
        maxStakingEpoch,
        delegatorRewardExpected,
        validatorRewardExpected
      } = await _claimRewardStakeIncreasing(
        epochsPoolRewarded,
        epochsStakeIncreased
      );

      const delegatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(delegator));
      let weiSpent = new BN(0);
      let epochsPoolRewardedRandom = epochsPoolRewarded;
      shuffle(epochsPoolRewardedRandom);
      for (let i = 0; i < epochsPoolRewardedRandom.length; i++) {
        const stakingEpoch = epochsPoolRewardedRandom[i];
        let result = await stakingHbbft.claimReward([stakingEpoch], stakingAddress, {from: delegator}).should.be.fulfilled;
        let tx = await web3.eth.getTransaction(result.tx);
        weiSpent = weiSpent.add((new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice)));
        // Call once again to ensure the reward cannot be withdrawn twice
        result = await stakingHbbft.claimReward([stakingEpoch], stakingAddress, {from: delegator}).should.be.fulfilled;
        tx = await web3.eth.getTransaction(result.tx);
        weiSpent = weiSpent.add((new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice)));
      }
      const delegatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(delegator));
      delegatorCoinsBalanceAfter.should.be.bignumber.equal(delegatorCoinsBalanceBefore.add(delegatorRewardExpected).sub(weiSpent));

      const validatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(stakingAddress));
      weiSpent = new BN(0);
      shuffle(epochsPoolRewardedRandom);
      for (let i = 0; i < epochsPoolRewardedRandom.length; i++) {
        const stakingEpoch = epochsPoolRewardedRandom[i];
        const result = await stakingHbbft.claimReward([stakingEpoch], stakingAddress, {from: stakingAddress}).should.be.fulfilled;
        const tx = await web3.eth.getTransaction(result.tx);
        weiSpent = weiSpent.add((new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice)));
      }
      const validatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(stakingAddress));
      validatorCoinsBalanceAfter.should.be.bignumber.equal(validatorCoinsBalanceBefore.add(validatorRewardExpected).sub(weiSpent));

      const blockRewardBalanceExpected = epochPoolReward.mul(new BN(epochsPoolRewarded.length)).sub(delegatorRewardExpected).sub(validatorRewardExpected);
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(blockRewardBalanceExpected);
    }

    async function testClaimRewardAfterStakeIncreasing(epochsPoolRewarded, epochsStakeIncreased) {
      const {
        delegatorMinStake,
        miningAddress,
        stakingAddress,
        epochPoolReward,
        maxStakingEpoch,
        delegatorRewardExpected,
        validatorRewardExpected
      } = await _claimRewardStakeIncreasing(
        epochsPoolRewarded,
        epochsStakeIncreased
      );

      let rewardAmountsCalculated = await stakingHbbft.getRewardAmount.call([], stakingAddress, delegator);
      rewardAmountsCalculated.should.be.bignumber.equal(delegatorRewardExpected);

      const delegatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(delegator));
      const result = await stakingHbbft.claimReward([], stakingAddress, {from: delegator}).should.be.fulfilled;
      const tx = await web3.eth.getTransaction(result.tx);
      const weiSpent = (new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice));
      const delegatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(delegator));

      delegatorCoinsBalanceAfter.should.be.bignumber.equal(delegatorCoinsBalanceBefore.add(delegatorRewardExpected).sub(weiSpent));

      rewardAmountsCalculated = await stakingHbbft.getRewardAmount.call([], stakingAddress, stakingAddress);
      rewardAmountsCalculated.should.be.bignumber.equal(validatorRewardExpected);

      await stakingHbbft.claimReward([], stakingAddress, {from: stakingAddress}).should.be.fulfilled;

      const blockRewardBalanceExpected = epochPoolReward.mul(new BN(epochsPoolRewarded.length)).sub(delegatorRewardExpected).sub(validatorRewardExpected);

      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(blockRewardBalanceExpected);
    }

    async function testClaimRewardAfterStakeMovements(epochsPoolRewarded, epochsStakeMovement) {
      const miningAddress = initialValidators[0];
      const stakingAddress = initialStakingAddresses[0];
      const epochPoolReward = new BN(web3.utils.toWei('1', 'ether'));

      (await web3.eth.getBalance(blockRewardHbbft.address)).should.be.equal('0');

      for (let i = 0; i < epochsPoolRewarded.length; i++) {
        const stakingEpoch = epochsPoolRewarded[i];

        // Emulate snapshotting for the pool
        await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch, miningAddress).should.be.fulfilled;

        // Emulate rewards for the pool
        await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, {value: epochPoolReward}).should.be.fulfilled;
      }

      // initial validator got reward for epochsPoolRewarded
      (await blockRewardHbbft.epochsPoolGotRewardFor.call(miningAddress)).length.should.be.equal(epochsPoolRewarded.length);
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(epochPoolReward.mul(new BN(epochsPoolRewarded.length)));

      for (let i = 0; i < epochsStakeMovement.length; i++) {
        const stakingEpoch = epochsStakeMovement[i];

        // Emulate delegator's stake movement
        const startBlock = new BN(120954 * stakingEpoch + 1);
        await stakingHbbft.setStakingEpoch(stakingEpoch).should.be.fulfilled;
        await stakingHbbft.setValidatorSetAddress(owner).should.be.fulfilled;
        //await stakingHbbft.setStakingEpochStartBlock(startBlock).should.be.fulfilled;
        await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
        //await setCurrentBlockNumber(startBlock);
        await stakingHbbft.orderWithdraw(stakingAddress, delegatorMinStake, {from: delegator}).should.be.fulfilled;
        await stakingHbbft.orderWithdraw(stakingAddress, delegatorMinStake.neg(), {from: delegator}).should.be.fulfilled;
      }

      const stakeFirstEpoch = await stakingHbbft.stakeFirstEpoch.call(stakingAddress, delegator);
      await stakingHbbft.setStakeFirstEpoch(stakingAddress, delegator, 0);
      await stakingHbbft.claimReward([], stakingAddress, {from: delegator}).should.be.rejectedWith("Claim: first epoch can't be 0");
      await stakingHbbft.setStakeFirstEpoch(stakingAddress, delegator, stakeFirstEpoch);

      if (epochsPoolRewarded.length > 0) {
        if (epochsPoolRewarded.length > 1) {
          const reversedEpochsPoolRewarded = [...epochsPoolRewarded].reverse();
          const currentEpoch = (await stakingHbbft.stakingEpoch.call()).toNumber();
          if (reversedEpochsPoolRewarded[0] < currentEpoch) {
            await stakingHbbft.claimReward(reversedEpochsPoolRewarded, stakingAddress, {from: delegator}).should.be.rejectedWith("Claim: need strictly increasing order.");
          } else {
            await stakingHbbft.claimReward([], stakingAddress, {from: delegator}).should.be.rejectedWith("Claim: only before current epoch.");    
          }
        }

        await stakingHbbft.setStakingEpoch(epochsPoolRewarded[epochsPoolRewarded.length - 1]).should.be.fulfilled;
        await stakingHbbft.claimReward([], stakingAddress, {from: delegator}).should.be.rejectedWith("Claim: only before current epoch.");
        await stakingHbbft.setStakingEpoch(epochsPoolRewarded[epochsPoolRewarded.length - 1] + 1).should.be.fulfilled;

        if (epochsPoolRewarded.length == 1) {
          const validatorStakeAmount = await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(epochsPoolRewarded[0], miningAddress);
          await blockRewardHbbft.setSnapshotPoolValidatorStakeAmount(epochsPoolRewarded[0], miningAddress, 0);
          const result = await stakingHbbft.claimReward([], stakingAddress, {from: delegator}).should.be.fulfilled;
          result.logs.length.should.be.equal(1);
          result.logs[0].args.nativeCoinsAmount.should.be.bignumber.equal(new BN(0));
          await blockRewardHbbft.setSnapshotPoolValidatorStakeAmount(epochsPoolRewarded[0], miningAddress, validatorStakeAmount);
          await stakingHbbft.clearRewardWasTaken(stakingAddress, delegator, epochsPoolRewarded[0]);
        }
      }
      //staked half the amount, hence .div(2)
      const delegatorRewardExpected = epochPoolReward.mul(new BN(epochsPoolRewarded.length)).div(new BN(2));

      const rewardAmountsCalculated = await stakingHbbft.getRewardAmount.call([], stakingAddress, delegator);
      rewardAmountsCalculated.should.be.bignumber.equal(delegatorRewardExpected);

      const delegatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(delegator));
      let weiSpent = new BN(0);
      for (let i = 0; i < 3; i++) {
        // We call `claimReward` several times, but it withdraws the reward only once
        const result = await stakingHbbft.claimReward([], stakingAddress, {from: delegator}).should.be.fulfilled;
        const tx = await web3.eth.getTransaction(result.tx);
        weiSpent = weiSpent.add((new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice)));
      }
      const delegatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(delegator));

      delegatorCoinsBalanceAfter.should.be.bignumber.equal(delegatorCoinsBalanceBefore.add(delegatorRewardExpected).sub(weiSpent));

      for (let i = 0; i < 3; i++) {
        // We call `claimReward` several times, but it withdraws the reward only once
        const result = await stakingHbbft.claimReward([], stakingAddress, {from: stakingAddress}).should.be.fulfilled;
        if (i == 0) {
          result.logs.length.should.be.equal(epochsPoolRewarded.length);
        } else {
          result.logs.length.should.be.equal(0);
        }
      }
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(new BN(0));
    }

    it('reward tries to be withdrawn before first stake', async () => {
      const {
        miningAddress,
        stakingAddress,
        epochPoolReward
      } = await _delegatorNeverStakedBefore();

      // Emulate snapshotting and rewards for the pool on the epoch #9
      let stakingEpoch = 9;
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch, miningAddress).should.be.fulfilled;
      await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, {value: epochPoolReward}).should.be.fulfilled;
      (await blockRewardHbbft.epochPoolNativeReward.call(stakingEpoch, miningAddress)).should.be.bignumber.equal(epochPoolReward);
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress).should.be.fulfilled;

      // Emulate the delegator's first stake on epoch #10
      stakingEpoch = 10;
      
      await stakingHbbft.setStakingEpoch(stakingEpoch).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress(owner).should.be.fulfilled;
      //await stakingHbbft.setStakingEpochStartBlock(startBlock).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
      //await setCurrentBlockNumber(startBlock);
      await stakingHbbft.stake(stakingAddress, {from: delegator, value: delegatorMinStake}).should.be.fulfilled;
      await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, {value: epochPoolReward}).should.be.fulfilled;
      (await blockRewardHbbft.epochPoolNativeReward.call(stakingEpoch, miningAddress)).should.be.bignumber.equal(epochPoolReward);
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress).should.be.fulfilled;

      // // Emulate rewards for the pool on epoch #11
      stakingEpoch = 11;
      await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, {value: epochPoolReward}).should.be.fulfilled;
      (await blockRewardHbbft.epochPoolNativeReward.call(stakingEpoch, miningAddress)).should.be.bignumber.equal(epochPoolReward);
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress).should.be.fulfilled;

      await stakingHbbft.setStakingEpoch(12).should.be.fulfilled;

      const rewardAmountsCalculated = await stakingHbbft.getRewardAmount.call([9, 10], stakingAddress, delegator);
      rewardAmountsCalculated.should.be.bignumber.equal(new BN(0));

      const delegatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(delegator));
      let result = await stakingHbbft.claimReward([9, 10], stakingAddress, {from: delegator}).should.be.fulfilled;
      const tx = await web3.eth.getTransaction(result.tx);
      const weiSpent = (new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice));
      const delegatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(delegator));

      result.logs.length.should.be.equal(0);
      delegatorCoinsBalanceAfter.should.be.bignumber.equal(delegatorCoinsBalanceBefore.sub(weiSpent));

      result = await stakingHbbft.claimReward([], stakingAddress, {from: stakingAddress}).should.be.fulfilled;
      result.logs.length.should.be.equal(5);
      result.logs[0].args.stakingEpoch.should.be.bignumber.equal(new BN(1));
      result.logs[1].args.stakingEpoch.should.be.bignumber.equal(new BN(2));
      result.logs[2].args.stakingEpoch.should.be.bignumber.equal(new BN(9));
      result.logs[3].args.stakingEpoch.should.be.bignumber.equal(new BN(10));
      result.logs[4].args.stakingEpoch.should.be.bignumber.equal(new BN(11));

      result = await stakingHbbft.claimReward([], stakingAddress, {from: delegator}).should.be.fulfilled;
      result.logs.length.should.be.equal(1);
      result.logs[0].args.stakingEpoch.should.be.bignumber.equal(new BN(11));

      (await stakingHbbft.stakeFirstEpoch.call(stakingAddress, delegator)).should.be.bignumber.equal(new BN(11));
      (await stakingHbbft.stakeLastEpoch.call(stakingAddress, delegator)).should.be.bignumber.equal(new BN(0));
    });

    it('delegator stakes and withdraws at the same epoch', async () => {
      const {
        miningAddress,
        stakingAddress,
        epochPoolReward
      } = await _delegatorNeverStakedBefore();

      // Emulate snapshotting and rewards for the pool on the epoch #9
      let stakingEpoch = 9;
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch, miningAddress).should.be.fulfilled;
      await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, {value: epochPoolReward}).should.be.fulfilled;
      (await blockRewardHbbft.epochPoolNativeReward.call(stakingEpoch, miningAddress)).should.be.bignumber.equal(epochPoolReward);
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress).should.be.fulfilled;

      // Emulate the delegator's first stake and withdrawal on epoch #10
      stakingEpoch = 10;
      startBlock = new BN(120954 * stakingEpoch + 1);
      await stakingHbbft.setStakingEpoch(stakingEpoch).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress(owner).should.be.fulfilled;
      //await stakingHbbft.setStakingEpochStartBlock(startBlock).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
      //await setCurrentBlockNumber(startBlock);
      await stakingHbbft.stake(stakingAddress, {from: delegator, value: delegatorMinStake}).should.be.fulfilled;
      await stakingHbbft.withdraw(stakingAddress, delegatorMinStake, {from: delegator}).should.be.fulfilled;
      await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, {value: epochPoolReward}).should.be.fulfilled;
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress).should.be.fulfilled;

      // Emulate rewards for the pool on epoch #11
      stakingEpoch = 11;
      await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, {value: epochPoolReward}).should.be.fulfilled;
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress).should.be.fulfilled;

      await stakingHbbft.setStakingEpoch(12).should.be.fulfilled;

      const rewardAmountsCalculated = await stakingHbbft.getRewardAmount.call([], stakingAddress, delegator);
      rewardAmountsCalculated.should.be.bignumber.equal(new BN(0));

      
      const delegatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(delegator));
      let result = await stakingHbbft.claimReward([], stakingAddress, {from: delegator}).should.be.fulfilled;
      const tx = await web3.eth.getTransaction(result.tx);
      const weiSpent = (new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice));
      const delegatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(delegator));

      result.logs.length.should.be.equal(0);
      delegatorCoinsBalanceAfter.should.be.bignumber.equal(delegatorCoinsBalanceBefore.sub(weiSpent));

      result = await stakingHbbft.claimReward([], stakingAddress, {from: stakingAddress}).should.be.fulfilled;
      result.logs.length.should.be.equal(5);
      result.logs[0].args.stakingEpoch.should.be.bignumber.equal(new BN(1));
      result.logs[1].args.stakingEpoch.should.be.bignumber.equal(new BN(2));
      result.logs[2].args.stakingEpoch.should.be.bignumber.equal(new BN(9));
      result.logs[3].args.stakingEpoch.should.be.bignumber.equal(new BN(10));
      result.logs[4].args.stakingEpoch.should.be.bignumber.equal(new BN(11));

      (await stakingHbbft.stakeFirstEpoch.call(stakingAddress, delegator)).should.be.bignumber.equal(new BN(11));
      (await stakingHbbft.stakeLastEpoch.call(stakingAddress, delegator)).should.be.bignumber.equal(new BN(11));
    });

    it('non-rewarded epochs are passed', async () => {
      const miningAddress = initialValidators[0];
      const stakingAddress = initialStakingAddresses[0];
      const epochPoolReward = new BN(web3.utils.toWei('1', 'ether'));

      const epochsPoolRewarded = [10, 20, 30, 40, 50];
      for (let i = 0; i < epochsPoolRewarded.length; i++) {
        const stakingEpoch = epochsPoolRewarded[i];

        // Emulate snapshotting for the pool
        await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch, miningAddress).should.be.fulfilled;

        // Emulate rewards for the pool
        await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, {value: epochPoolReward}).should.be.fulfilled;
      }
      // initial validator got reward for epochs: [10, 20, 30, 40, 50]
      (await blockRewardHbbft.epochsPoolGotRewardFor.call(miningAddress)).length.should.be.equal(5);

      await stakingHbbft.setStakingEpoch(51);

      const epochsToWithdrawFrom = [15, 25, 35, 45];
      const delegatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(delegator));
      const result = await stakingHbbft.claimReward(epochsToWithdrawFrom, stakingAddress, {from: delegator}).should.be.fulfilled;
      const tx = await web3.eth.getTransaction(result.tx);
      const weiSpent = (new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice));
      const delegatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(delegator));

      result.logs.length.should.be.equal(epochsToWithdrawFrom.length);
      for (let i = 0; i < result.logs.length; i++) {
        result.logs[i].args.stakingEpoch.should.be.bignumber.equal(new BN(epochsToWithdrawFrom[i]));
        result.logs[i].args.nativeCoinsAmount.should.be.bignumber.equal(new BN(0));
      }

      delegatorCoinsBalanceAfter.should.be.bignumber.equal(delegatorCoinsBalanceBefore.sub(weiSpent));
    });

    it('stake movements 1', async () => {
      await testClaimRewardAfterStakeMovements(
        [5, 15, 25, 35],
        [10, 20, 30]
      );
    });
    it('stake movements 2', async () => {
      await testClaimRewardAfterStakeMovements(
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        [1, 2, 3, 4, 5, 6, 7, 8, 9]
      );
    });
    it('stake movements 3', async () => {
      await testClaimRewardAfterStakeMovements(
        [1, 3, 6, 10],
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
      );
    });
    it('stake movements 4', async () => {
      await testClaimRewardAfterStakeMovements(
        [],
        [1, 2, 3]
      );
    });
    it('stake movements 5', async () => {
      await testClaimRewardAfterStakeMovements(
        [2],
        [1, 2, 3]
      );
    });

    it('stake increasing 1', async () => {
      await testClaimRewardAfterStakeIncreasing(
        [5, 15, 25, 35],
        [4, 14, 24, 34]
      );
    });
    it('stake increasing 2', async () => {
      await testClaimRewardAfterStakeIncreasing(
        [5, 15, 25, 35],
        [10, 20, 30]
      );
    });
    it('stake increasing 3', async () => {
      await testClaimRewardAfterStakeIncreasing(
        [1, 2, 3, 4, 5, 6],
        [1, 2, 3, 4, 5]
      );
    });
    it('stake increasing 4', async () => {
      await testClaimRewardAfterStakeIncreasing(
        [1, 3, 6, 10],
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
      );
    });
    it('stake increasing 5', async () => {
      await testClaimRewardAfterStakeIncreasing(
        [5, 15, 25],
        [5, 15, 25]
      );
    });
    it('stake increasing', async () => {
      await testClaimRewardAfterStakeIncreasing(
        [5, 7, 9],
        [6, 8, 10]
      );
    });

    it('random withdrawal 1', async () => {
      await testClaimRewardRandom(
        [5, 15, 25, 35],
        [4, 14, 24, 34]
      );
    });
    it('random withdrawal 2', async () => {
      await testClaimRewardRandom(
        [5, 15, 25, 35],
        [10, 20, 30]
      );
    });
    it('random withdrawal 3', async () => {
      await testClaimRewardRandom(
        [1, 2, 3, 4, 5, 6],
        [1, 2, 3, 4, 5]
      );
    });
    it('random withdrawal 4', async () => {
      await testClaimRewardRandom(
        [1, 3, 6, 10],
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
      );
    });
    it('random withdrawal 5', async () => {
      await testClaimRewardRandom(
        [5, 15, 25],
        [5, 15, 25]
      );
    });
    it('random withdrawal 6', async () => {
      await testClaimRewardRandom(
        [5, 7, 9],
        [6, 8, 10]
      );
    });

    it('reward got from the first epoch', async () => {
      await testClaimRewardAfterStakeMovements([1], []);
    });

    it('stake is withdrawn forever 1', async () => {
      const miningAddress = initialValidators[0];
      const stakingAddress = initialStakingAddresses[0];
      const epochPoolReward = new BN(web3.utils.toWei('1', 'ether'));

      (await web3.eth.getBalance(blockRewardHbbft.address)).should.be.equal('0');

      let stakingEpoch;

      // Emulate snapshotting and rewards for the pool
      stakingEpoch = 9;
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch, miningAddress).should.be.fulfilled;
      await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, {value: epochPoolReward}).should.be.fulfilled;
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(epochPoolReward);
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress).should.be.fulfilled;

      // Emulate delegator's stake withdrawal
      stakingEpoch = 10;
      //const stakingEpochStartBlock = new BN(120954 * stakingEpoch + 1);
      await stakingHbbft.setStakingEpoch(stakingEpoch).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress(owner).should.be.fulfilled;
      //await stakingHbbft.setStakingEpochStartBlock(stakingEpochStartBlock).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
      //await setCurrentBlockNumber(stakingEpochStartBlock);
      await stakingHbbft.orderWithdraw(stakingAddress, delegatorMinStake, {from: delegator}).should.be.fulfilled;
      await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, {value: epochPoolReward}).should.be.fulfilled;
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(epochPoolReward.mul(new BN(2)));
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress).should.be.fulfilled;

      // Emulate rewards for the pool
      stakingEpoch = 11;
      await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, {value: epochPoolReward}).should.be.fulfilled;
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(epochPoolReward.mul(new BN(3)));
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress).should.be.fulfilled;

      await stakingHbbft.setStakingEpoch(12).should.be.fulfilled;

      const delegatorRewardExpected = epochPoolReward.mul(new BN(2)).div(new BN(2));

      const rewardAmountsCalculated = await stakingHbbft.getRewardAmount.call([], stakingAddress, delegator);
      rewardAmountsCalculated.should.be.bignumber.equal(delegatorRewardExpected);

      const delegatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(delegator));
      let result = await stakingHbbft.claimReward([], stakingAddress, {from: delegator}).should.be.fulfilled;
      const tx = await web3.eth.getTransaction(result.tx);
      const weiSpent = (new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice));
      const delegatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(delegator));

      result.logs.length.should.be.equal(2);
      result.logs[0].event.should.be.equal("ClaimedReward");
      result.logs[0].args.stakingEpoch.should.be.bignumber.equal(new BN(9));
      result.logs[0].args.nativeCoinsAmount.should.be.bignumber.equal(epochPoolReward.div(new BN(2)));
      result.logs[1].event.should.be.equal("ClaimedReward");
      result.logs[1].args.stakingEpoch.should.be.bignumber.equal(new BN(10));
      result.logs[1].args.nativeCoinsAmount.should.be.bignumber.equal(epochPoolReward.div(new BN(2)));

      delegatorCoinsBalanceAfter.should.be.bignumber.equal(delegatorCoinsBalanceBefore.add(delegatorRewardExpected).sub(weiSpent));

      result = await stakingHbbft.claimReward([], stakingAddress, {from: stakingAddress}).should.be.fulfilled;
      result.logs.length.should.be.equal(3);
      result.logs[0].args.stakingEpoch.should.be.bignumber.equal(new BN(9));
      result.logs[1].args.stakingEpoch.should.be.bignumber.equal(new BN(10));
      result.logs[2].args.stakingEpoch.should.be.bignumber.equal(new BN(11));
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(new BN(0));
    });

    it('stake is withdrawn forever 2', async () => {
      const miningAddress = initialValidators[0];
      const stakingAddress = initialStakingAddresses[0];
      const epochPoolReward = new BN(web3.utils.toWei('1', 'ether'));

      (await web3.eth.getBalance(blockRewardHbbft.address)).should.be.equal('0');

      let stakingEpoch;

      // Emulate snapshotting and rewards for the pool
      stakingEpoch = 9;
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch, miningAddress).should.be.fulfilled;
      await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, {value: epochPoolReward}).should.be.fulfilled;
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(epochPoolReward);
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress).should.be.fulfilled;

      // Emulate delegator's stake withdrawal
      stakingEpoch = 10;
      //const stakingEpochStartBlock = new BN(120954 * stakingEpoch + 1);
      await stakingHbbft.setStakingEpoch(stakingEpoch).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress(owner).should.be.fulfilled;
      //await stakingHbbft.setStakingEpochStartBlock(stakingEpochStartBlock).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
      //await setCurrentBlockNumber(stakingEpochStartBlock);
      await stakingHbbft.orderWithdraw(stakingAddress, delegatorMinStake, {from: delegator}).should.be.fulfilled;
      await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, {value: epochPoolReward}).should.be.fulfilled;
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(epochPoolReward.mul(new BN(2)));
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress).should.be.fulfilled;

      // Emulate rewards for the pool
      stakingEpoch = 11;
      await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, {value: epochPoolReward}).should.be.fulfilled;
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(epochPoolReward.mul(new BN(3)));
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress).should.be.fulfilled;

      await stakingHbbft.setStakingEpoch(12).should.be.fulfilled;

      const rewardAmountsCalculated = await stakingHbbft.getRewardAmount.call([11], stakingAddress, delegator);
      rewardAmountsCalculated.should.be.bignumber.equal(new BN(0));

      const delegatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(delegator));
      const result = await stakingHbbft.claimReward([11], stakingAddress, {from: delegator}).should.be.fulfilled;
      const tx = await web3.eth.getTransaction(result.tx);
      const weiSpent = (new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice));
      const delegatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(delegator));

      result.logs.length.should.be.equal(0);
      delegatorCoinsBalanceAfter.should.be.bignumber.equal(delegatorCoinsBalanceBefore.sub(weiSpent));
    });

    it('gas consumption for one staking epoch is OK', async () => {
      const stakingEpoch = 2600;

      for (let i = 0; i < initialValidators.length; i++) {
        await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch, initialValidators[i]);
      }

      await stakingHbbft.setStakingEpoch(stakingEpoch-1).should.be.fulfilled;
      let epochStartBlock = new BN(120954 * (stakingEpoch-1) + 1);
      //await setCurrentBlockNumber(epochStartBlock);
      await stakingHbbft.setValidatorSetAddress(owner).should.be.fulfilled;
      //await stakingHbbft.setStakingEpochStartBlock(epochStartBlock).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
      // new validatorSet at the end of fixed epoch duration
      //let fixedEpochEndBlock = await stakingHbbft.stakingFixedEpochEndBlock.call();
      //await setCurrentBlockNumber(fixedEpochEndBlock);
      await callReward(false);
      // startBlock is the upcoming epoch 1st block
      // let epochEndBlock = epochStartBlock.add(stakingFixedEpochDuration).add(new BN(2)).sub(new BN(1)); // +2 for the keyGen duration
      // let endBlock = (await stakingHbbft.stakingFixedEpochEndBlock.call()).add(keyGenerationDuration);
      // epochEndBlock.should.be.bignumber.equal(endBlock);
      //await setCurrentBlockNumber(endBlock);

      await callFinalizeChange();
      (await validatorSetHbbft.getValidators.call()).should.be.deep.equal(initialValidators);
      // new epoch = stakingEpoch
      (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(new BN(stakingEpoch));
      //epochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
      //epochStartBlock.should.be.bignumber.equal(new BN(120954 * stakingEpoch + 2 + 1)); // +2 for kegen duration

      //fixedEpochEndBlock = await stakingHbbft.stakingFixedEpochEndBlock.call();
      //await setCurrentBlockNumber(fixedEpochEndBlock);
      await callReward(false);

      endBlock = fixedEpochEndBlock.add(keyGenerationDuration);
      //await setCurrentBlockNumber(endBlock);

      let blockRewardCoinsBalanceBefore = new BN(await web3.eth.getBalance(blockRewardHbbft.address));
      
      for (let i = 0; i < initialValidators.length; i++) {
        (await blockRewardHbbft.epochPoolNativeReward.call(stakingEpoch, initialValidators[i])).should.be.bignumber.equal(new BN(0));
      }
      
      await callReward(true);
      await callFinalizeChange();

      (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(new BN(stakingEpoch + 1));
      //epochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
      //epochStartBlock.should.be.bignumber.equal(new BN(120954 * (stakingEpoch + 1) + 2 + 2 + 1)); // +2 for kegen duration
      
      let distributedCoinsAmount = new BN(0);
      for (let i = 0; i < initialValidators.length; i++) {
        const epochPoolNativeReward = await blockRewardHbbft.epochPoolNativeReward.call(stakingEpoch, initialValidators[i]);
        epochPoolNativeReward.should.be.bignumber.above(new BN(0));
        distributedCoinsAmount = distributedCoinsAmount.add(epochPoolNativeReward);
      }
      let blockRewardCoinsBalanceAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));
      blockRewardCoinsBalanceAfter.should.be.bignumber.equal(blockRewardCoinsBalanceBefore.add(distributedCoinsAmount));

      // The delegator claims their rewards
      const delegatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(delegator));

      blockRewardCoinsBalanceBefore = new BN(await web3.eth.getBalance(blockRewardHbbft.address));

      const expectedClaimRewardAmounts = (await stakingHbbft.getRewardAmount.call([stakingEpoch], initialStakingAddresses[0], delegator));

      result = await stakingHbbft.claimReward([stakingEpoch], initialStakingAddresses[0], {from: delegator}).should.be.fulfilled;

      result.logs[0].event.should.be.equal("ClaimedReward");
      result.logs[0].args.fromPoolStakingAddress.should.be.equal(initialStakingAddresses[0]);
      result.logs[0].args.staker.should.be.equal(delegator);
      result.logs[0].args.stakingEpoch.should.be.bignumber.equal(new BN(stakingEpoch));

      const claimedCoinsAmount = result.logs[0].args.nativeCoinsAmount;
      expectedClaimRewardAmounts.should.be.bignumber.equal(claimedCoinsAmount);

      const tx = await web3.eth.getTransaction(result.tx);
      const weiSpent = (new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice));

      if (!!process.env.SOLIDITY_COVERAGE !== true) {
        // result.receipt.gasUsed.should.be.below(1700000);
        result.receipt.gasUsed.should.be.below(3020000); // for Istanbul
      }

      const delegatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(delegator));
      blockRewardCoinsBalanceAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));
      delegatorCoinsBalanceAfter.should.be.bignumber.equal(delegatorCoinsBalanceBefore.add(claimedCoinsAmount).sub(weiSpent));
      blockRewardCoinsBalanceAfter.should.be.bignumber.equal(blockRewardCoinsBalanceBefore.sub(claimedCoinsAmount));
    });

    it('gas consumption for 20 staking epochs is OK', async () => {
      const maxStakingEpoch = 20;
      maxStakingEpoch.should.be.above(2);

      // Loop of staking epochs
      for (let stakingEpoch = 1; stakingEpoch <= maxStakingEpoch; stakingEpoch++) {
        // Finalize change i.e. finalize pending validators, increase epoch and set stakingEpochStartBlock
        if ( stakingEpoch == 1) {
          await stakingHbbft.setStakingEpoch(1).should.be.fulfilled;
          const startBlock = new BN(120954 + 2 + 1);
          //await setCurrentBlockNumber(startBlock);
          await stakingHbbft.setValidatorSetAddress(owner).should.be.fulfilled;
          //await stakingHbbft.setStakingEpochStartBlock(startBlock).should.be.fulfilled;
          await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
        }

        (await validatorSetHbbft.getValidators.call()).should.be.deep.equal(initialValidators);
        (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(new BN(stakingEpoch));

        //const epochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
        //epochStartBlock.should.be.bignumber.equal(new BN((120954+2) * stakingEpoch + 1));

        //const fixedEpochEndBlock = await stakingHbbft.stakingFixedEpochEndBlock.call();
        //await setCurrentBlockNumber(fixedEpochEndBlock);
        await callReward(false);

        //const epochEndBlock = fixedEpochEndBlock.add(keyGenerationDuration);
        //await setCurrentBlockNumber(epochEndBlock);

        const blockRewardCoinsBalanceBefore = new BN(await web3.eth.getBalance(blockRewardHbbft.address));
        for (let i = 0; i < initialValidators.length; i++) {
          (await blockRewardHbbft.epochPoolNativeReward.call(stakingEpoch, initialValidators[i])).should.be.bignumber.equal(new BN(0));
        }
        await callReward(true);
        await callFinalizeChange();
        let distributedCoinsAmount = new BN(0);
        for (let i = 0; i < initialValidators.length; i++) {
          const epochPoolNativeReward = await blockRewardHbbft.epochPoolNativeReward.call(stakingEpoch, initialValidators[i]);
          epochPoolNativeReward.should.be.bignumber.above(new BN(0));
          distributedCoinsAmount = distributedCoinsAmount.add(epochPoolNativeReward);
        }
        const blockRewardCoinsBalanceAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));
        blockRewardCoinsBalanceAfter.should.be.bignumber.equal(blockRewardCoinsBalanceBefore.add(distributedCoinsAmount));
      }

      // The delegator claims their rewards
      let initialGasConsumption = new BN(0);
      let startGasConsumption = new BN(0);
      let endGasConsumption = new BN(0);
      let blockRewardCoinsBalanceTotalBefore = new BN(await web3.eth.getBalance(blockRewardHbbft.address));

      let coinsDelegatorGotForAllEpochs = new BN(0);
      for (let stakingEpoch = 1; stakingEpoch <= maxStakingEpoch; stakingEpoch++) {
        const delegatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(delegator));

        const blockRewardCoinsBalanceBefore = new BN(await web3.eth.getBalance(blockRewardHbbft.address));

        const expectedClaimRewardAmounts = (await stakingHbbft.getRewardAmount.call([stakingEpoch], initialStakingAddresses[0], delegator));

        let result = await stakingHbbft.claimReward([stakingEpoch], initialStakingAddresses[0], {from: delegator}).should.be.fulfilled;
        result.logs[0].event.should.be.equal("ClaimedReward");
        result.logs[0].args.fromPoolStakingAddress.should.be.equal(initialStakingAddresses[0]);
        result.logs[0].args.staker.should.be.equal(delegator);
        result.logs[0].args.stakingEpoch.should.be.bignumber.equal(new BN(stakingEpoch));

        const claimedCoinsAmount = result.logs[0].args.nativeCoinsAmount;

        expectedClaimRewardAmounts.should.be.bignumber.equal(claimedCoinsAmount);

        const tx = await web3.eth.getTransaction(result.tx);
        const weiSpent = (new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice));

        if (stakingEpoch == 1) {
          initialGasConsumption = new BN(result.receipt.gasUsed);
        } else if (stakingEpoch == 2) {
          startGasConsumption = new BN(result.receipt.gasUsed);
        } else if (stakingEpoch == maxStakingEpoch) {
          endGasConsumption = new BN(result.receipt.gasUsed);
        }

        const delegatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(delegator));
        const blockRewardCoinsBalanceAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));
        delegatorCoinsBalanceAfter.should.be.bignumber.equal(delegatorCoinsBalanceBefore.add(claimedCoinsAmount).sub(weiSpent));
        blockRewardCoinsBalanceAfter.should.be.bignumber.equal(blockRewardCoinsBalanceBefore.sub(claimedCoinsAmount));

        coinsDelegatorGotForAllEpochs = coinsDelegatorGotForAllEpochs.add(claimedCoinsAmount);

        // console.log(`stakingEpoch = ${stakingEpoch}, gasUsed = ${result.receipt.gasUsed}, cumulativeGasUsed = ${result.receipt.cumulativeGasUsed}`);
      }

      if (!!process.env.SOLIDITY_COVERAGE !== true) {
        const perEpochGasConsumption = endGasConsumption.sub(startGasConsumption).div(new BN(maxStakingEpoch - 2));
        // perEpochGasConsumption.should.be.bignumber.equal(new BN(509));
        perEpochGasConsumption.should.be.bignumber.equal(new BN(1109)); // for Istanbul

        // Check gas consumption for the case when the delegator didn't touch their
        // stake for 50 years (2600 staking epochs)
        const maxGasConsumption = initialGasConsumption.sub(perEpochGasConsumption).add(perEpochGasConsumption.mul(new BN(2600)));
        // maxGasConsumption.should.be.bignumber.below(new BN(1700000));
        maxGasConsumption.should.be.bignumber.below(new BN(3020000)); // for Istanbul
      }

      let blockRewardCoinsBalanceTotalAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));

      blockRewardCoinsBalanceTotalAfter.should.be.bignumber.equal(blockRewardCoinsBalanceTotalBefore.sub(coinsDelegatorGotForAllEpochs));

      // The validators claim their rewards
      let coinsValidatorsGotForAllEpochs = new BN(0);
      for (let v = 0; v < initialStakingAddresses.length; v++) {
        for (let stakingEpoch = 1; stakingEpoch <= maxStakingEpoch; stakingEpoch++) {
          const validator = initialStakingAddresses[v];
          const validatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(validator));
          const blockRewardCoinsBalanceBefore = new BN(await web3.eth.getBalance(blockRewardHbbft.address));

          const expectedClaimRewardAmounts = (await stakingHbbft.getRewardAmount.call([stakingEpoch], validator, validator));

          let result = await stakingHbbft.claimReward([stakingEpoch], validator, {from: validator}).should.be.fulfilled;
          result.logs[0].event.should.be.equal("ClaimedReward");
          result.logs[0].args.fromPoolStakingAddress.should.be.equal(validator);
          result.logs[0].args.staker.should.be.equal(validator);
          result.logs[0].args.stakingEpoch.should.be.bignumber.equal(new BN(stakingEpoch));

          const claimedCoinsAmount = result.logs[0].args.nativeCoinsAmount;

          expectedClaimRewardAmounts.should.be.bignumber.equal(claimedCoinsAmount);

          const tx = await web3.eth.getTransaction(result.tx);
          const weiSpent = (new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice));

          const validatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(validator));
          const blockRewardCoinsBalanceAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));

          validatorCoinsBalanceAfter.should.be.bignumber.equal(validatorCoinsBalanceBefore.add(claimedCoinsAmount).sub(weiSpent));
          blockRewardCoinsBalanceAfter.should.be.bignumber.equal(blockRewardCoinsBalanceBefore.sub(claimedCoinsAmount));

          coinsValidatorsGotForAllEpochs = coinsValidatorsGotForAllEpochs.add(claimedCoinsAmount);
        }
      }

      blockRewardCoinsBalanceTotalAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));
      blockRewardCoinsBalanceTotalAfter.should.be.bignumber.equal(blockRewardCoinsBalanceTotalBefore.sub(coinsDelegatorGotForAllEpochs).sub(coinsValidatorsGotForAllEpochs));
      blockRewardCoinsBalanceTotalAfter.should.be.bignumber.gte(new BN(0));
    });

    it('gas consumption for 52 staking epochs is OK 1', async () => {
      const maxStakingEpoch = 52;

      // Loop of staking epochs
      for (let stakingEpoch = 1; stakingEpoch <= maxStakingEpoch; stakingEpoch++) {
        if ( stakingEpoch == 1) {
          await stakingHbbft.setStakingEpoch(1).should.be.fulfilled;
          //const startBlock = new BN(120954 + 2 + 1);
          //await setCurrentBlockNumber(startBlock);
          await stakingHbbft.setValidatorSetAddress(owner).should.be.fulfilled;
          //await stakingHbbft.setStakingEpochStartBlock(startBlock).should.be.fulfilled;
          await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
        }

        (await validatorSetHbbft.getValidators.call()).should.be.deep.equal(initialValidators);
        (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(new BN(stakingEpoch));

        //const epochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
        //epochStartBlock.should.be.bignumber.equal(new BN((120954+2) * stakingEpoch + 1));

        //const fixedEpochEndBlock = await stakingHbbft.stakingFixedEpochEndBlock.call();
        //await setCurrentBlockNumber(fixedEpochEndBlock);
        await callReward(false);

        //const epochEndBlock = fixedEpochEndBlock.add(keyGenerationDuration);
        //await setCurrentBlockNumber(epochEndBlock);

        const blockRewardCoinsBalanceBefore = new BN(await web3.eth.getBalance(blockRewardHbbft.address));
        for (let i = 0; i < initialValidators.length; i++) {
          (await blockRewardHbbft.epochPoolNativeReward.call(stakingEpoch, initialValidators[i])).should.be.bignumber.equal(new BN(0));
        }
        await callReward(true);
        await callFinalizeChange();
        let distributedCoinsAmount = new BN(0);
        for (let i = 0; i < initialValidators.length; i++) {
          const epochPoolNativeReward = await blockRewardHbbft.epochPoolNativeReward.call(stakingEpoch, initialValidators[i]);
          epochPoolNativeReward.should.be.bignumber.above(new BN(0));
          distributedCoinsAmount = distributedCoinsAmount.add(epochPoolNativeReward);
        }
        const blockRewardCoinsBalanceAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));
        blockRewardCoinsBalanceAfter.should.be.bignumber.equal(blockRewardCoinsBalanceBefore.add(distributedCoinsAmount));
      }

      // The delegator claims their rewards
      const delegatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(delegator));
      const blockRewardCoinsBalanceBefore = new BN(await web3.eth.getBalance(blockRewardHbbft.address));
      const blockRewardCoinsBalanceTotalBefore = blockRewardCoinsBalanceBefore;

      const expectedClaimRewardAmounts = (await stakingHbbft.getRewardAmount.call([], initialStakingAddresses[0], delegator));

      const result = await stakingHbbft.claimReward([], initialStakingAddresses[0], {from: delegator}).should.be.fulfilled;

      let coinsDelegatorGotForAllEpochs = new BN(0);
      for (let i = 0; i < maxStakingEpoch; i++) {
        result.logs[i].event.should.be.equal("ClaimedReward");
        result.logs[i].args.fromPoolStakingAddress.should.be.equal(initialStakingAddresses[0]);
        result.logs[i].args.staker.should.be.equal(delegator);
        result.logs[i].args.stakingEpoch.should.be.bignumber.equal(new BN(i + 1));
        coinsDelegatorGotForAllEpochs = coinsDelegatorGotForAllEpochs.add(result.logs[i].args.nativeCoinsAmount);
      }

      expectedClaimRewardAmounts.should.be.bignumber.equal(coinsDelegatorGotForAllEpochs);

      const tx = await web3.eth.getTransaction(result.tx);
      const weiSpent = (new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice));

      // console.log(`gasUsed = ${result.receipt.gasUsed}, cumulativeGasUsed = ${result.receipt.cumulativeGasUsed}`);

      if (!!process.env.SOLIDITY_COVERAGE !== true) {
        // result.receipt.gasUsed.should.be.below(1710000);
        result.receipt.gasUsed.should.be.below(2100000); // for Istanbul
      }

      const delegatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(delegator));
      const blockRewardCoinsBalanceAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));

      coinsDelegatorGotForAllEpochs.should.be.bignumber.gte(new BN(0));
      delegatorCoinsBalanceAfter.should.be.bignumber.equal(delegatorCoinsBalanceBefore.add(coinsDelegatorGotForAllEpochs).sub(weiSpent));
      blockRewardCoinsBalanceAfter.should.be.bignumber.equal(blockRewardCoinsBalanceBefore.sub(coinsDelegatorGotForAllEpochs));

      // The validators claim their rewards
      let coinsValidatorsGotForAllEpochs = new BN(0);
      for (let v = 0; v < initialStakingAddresses.length; v++) {
        const validator = initialStakingAddresses[v];
        const validatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(validator));
        const blockRewardCoinsBalanceBefore = new BN(await web3.eth.getBalance(blockRewardHbbft.address));
        const expectedClaimRewardAmounts = (await stakingHbbft.getRewardAmount.call([], validator, validator));
        const result = await stakingHbbft.claimReward([], validator, {from: validator}).should.be.fulfilled;

        let claimedCoinsAmount = new BN(0);
        for (let i = 0; i < maxStakingEpoch; i++) {
          result.logs[i].event.should.be.equal("ClaimedReward");
          result.logs[i].args.fromPoolStakingAddress.should.be.equal(validator);
          result.logs[i].args.staker.should.be.equal(validator);
          result.logs[i].args.stakingEpoch.should.be.bignumber.equal(new BN(i + 1));
          claimedCoinsAmount = claimedCoinsAmount.add(result.logs[i].args.nativeCoinsAmount);
        }

        expectedClaimRewardAmounts.should.be.bignumber.equal(claimedCoinsAmount);

        const tx = await web3.eth.getTransaction(result.tx);
        const weiSpent = (new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice));

        const validatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(validator));
        const blockRewardCoinsBalanceAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));

        claimedCoinsAmount.should.be.bignumber.gte(new BN(0));
        validatorCoinsBalanceAfter.should.be.bignumber.equal(validatorCoinsBalanceBefore.add(claimedCoinsAmount).sub(weiSpent));
        blockRewardCoinsBalanceAfter.should.be.bignumber.equal(blockRewardCoinsBalanceBefore.sub(claimedCoinsAmount));
        coinsValidatorsGotForAllEpochs = coinsValidatorsGotForAllEpochs.add(claimedCoinsAmount);
      }

      const blockRewardCoinsBalanceTotalAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));
      blockRewardCoinsBalanceTotalAfter.should.be.bignumber.equal(blockRewardCoinsBalanceTotalBefore.sub(coinsDelegatorGotForAllEpochs).sub(coinsValidatorsGotForAllEpochs));
      blockRewardCoinsBalanceTotalAfter.should.be.bignumber.gte(new BN(0));
    });

    it('gas consumption for 52 staking epochs (including gaps ~ 10 years) is OK', async () => {
      const maxStakingEpochs = 52;
      const gapSize = 10;

      // Loop of staking epochs
      for (let s = 0; s < maxStakingEpochs; s++) {
        if ( s == 0) {
          await stakingHbbft.setStakingEpoch(1).should.be.fulfilled;
          const startBlock = new BN(120954 + 2 + 1);
          //await setCurrentBlockNumber(startBlock);
          await stakingHbbft.setValidatorSetAddress(owner).should.be.fulfilled;
          //await stakingHbbft.setStakingEpochStartBlock(startBlock).should.be.fulfilled;
          await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
        }

        const stakingEpoch = (await stakingHbbft.stakingEpoch.call()).toNumber();

        (await validatorSetHbbft.getValidators.call()).should.be.deep.equal(initialValidators);
        (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(new BN(stakingEpoch));

        //const epochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
        //epochStartBlock.should.be.bignumber.equal(new BN((120954+2) * stakingEpoch + 1));

        //const fixedEpochEndBlock = await stakingHbbft.stakingFixedEpochEndBlock.call();
        //await setCurrentBlockNumber(fixedEpochEndBlock);
        await callReward(false);

        //const epochEndBlock = fixedEpochEndBlock.add(keyGenerationDuration);
        //await setCurrentBlockNumber(epochEndBlock);

        const blockRewardCoinsBalanceBefore = new BN(await web3.eth.getBalance(blockRewardHbbft.address));
        for (let i = 0; i < initialValidators.length; i++) {
          (await blockRewardHbbft.epochPoolNativeReward.call(stakingEpoch, initialValidators[i])).should.be.bignumber.equal(new BN(0));
        }
        await callReward(true);
        await callFinalizeChange();
        let distributedCoinsAmount = new BN(0);
        for (let i = 0; i < initialValidators.length; i++) {
          const epochPoolNativeReward = await blockRewardHbbft.epochPoolNativeReward.call(stakingEpoch, initialValidators[i]);
          epochPoolNativeReward.should.be.bignumber.above(new BN(0));
          distributedCoinsAmount = distributedCoinsAmount.add(epochPoolNativeReward);
        }
        const blockRewardCoinsBalanceAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));
        blockRewardCoinsBalanceAfter.should.be.bignumber.equal(blockRewardCoinsBalanceBefore.add(distributedCoinsAmount));

        const nextStakingEpoch = stakingEpoch + gapSize; // jump through a few epochs
        await stakingHbbft.setStakingEpoch(nextStakingEpoch).should.be.fulfilled;
        await stakingHbbft.setValidatorSetAddress(owner).should.be.fulfilled;
        //await stakingHbbft.setStakingEpochStartBlock((120954 + 2) * nextStakingEpoch + 1).should.be.fulfilled;
        await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
        for (let i = 0; i < initialValidators.length; i++) {
          await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, nextStakingEpoch, initialValidators[i]);
        }
      }

      const epochsPoolGotRewardFor = await blockRewardHbbft.epochsPoolGotRewardFor.call(initialValidators[0]);

      // The delegator claims their rewards
      const delegatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(delegator));
      const blockRewardCoinsBalanceBefore = new BN(await web3.eth.getBalance(blockRewardHbbft.address));
      const blockRewardCoinsBalanceTotalBefore = blockRewardCoinsBalanceBefore;

      const expectedClaimRewardAmounts = (await stakingHbbft.getRewardAmount.call([], initialStakingAddresses[0], delegator));

      const result = await stakingHbbft.claimReward([], initialStakingAddresses[0], {from: delegator}).should.be.fulfilled;

      let coinsDelegatorGotForAllEpochs = new BN(0);
      for (let i = 0; i < maxStakingEpochs; i++) {
        result.logs[i].event.should.be.equal("ClaimedReward");
        result.logs[i].args.fromPoolStakingAddress.should.be.equal(initialStakingAddresses[0]);
        result.logs[i].args.staker.should.be.equal(delegator);
        result.logs[i].args.stakingEpoch.should.be.bignumber.equal(epochsPoolGotRewardFor[i]);
        coinsDelegatorGotForAllEpochs = coinsDelegatorGotForAllEpochs.add(result.logs[i].args.nativeCoinsAmount);
      }

      expectedClaimRewardAmounts.should.be.bignumber.equal(coinsDelegatorGotForAllEpochs);

      const tx = await web3.eth.getTransaction(result.tx);
      const weiSpent = (new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice));

      // console.log(`gasUsed = ${result.receipt.gasUsed}, cumulativeGasUsed = ${result.receipt.cumulativeGasUsed}`);

      if (!!process.env.SOLIDITY_COVERAGE !== true) {
        // result.receipt.gasUsed.should.be.below(2000000);
        result.receipt.gasUsed.should.be.below(2610000); // for Istanbul
      }

      const delegatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(delegator));
      const blockRewardCoinsBalanceAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));

      coinsDelegatorGotForAllEpochs.should.be.bignumber.gte(new BN(0));
      delegatorCoinsBalanceAfter.should.be.bignumber.equal(delegatorCoinsBalanceBefore.add(coinsDelegatorGotForAllEpochs).sub(weiSpent));
      blockRewardCoinsBalanceAfter.should.be.bignumber.equal(blockRewardCoinsBalanceBefore.sub(coinsDelegatorGotForAllEpochs));

      // The validators claim their rewards
      let coinsValidatorsGotForAllEpochs = new BN(0);
      for (let v = 0; v < initialStakingAddresses.length; v++) {
        const validator = initialStakingAddresses[v];
        const validatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(validator));
        const blockRewardCoinsBalanceBefore = new BN(await web3.eth.getBalance(blockRewardHbbft.address));
        const expectedClaimRewardAmounts = (await stakingHbbft.getRewardAmount.call([], validator, validator));
        const result = await stakingHbbft.claimReward([], validator, {from: validator}).should.be.fulfilled;

        let claimedCoinsAmount = new BN(0);
        for (let i = 0; i < maxStakingEpochs; i++) {
          result.logs[i].event.should.be.equal("ClaimedReward");
          result.logs[i].args.fromPoolStakingAddress.should.be.equal(validator);
          result.logs[i].args.staker.should.be.equal(validator);
          result.logs[i].args.stakingEpoch.should.be.bignumber.equal(epochsPoolGotRewardFor[i]);
          claimedCoinsAmount = claimedCoinsAmount.add(result.logs[i].args.nativeCoinsAmount);
        }

        expectedClaimRewardAmounts.should.be.bignumber.equal(claimedCoinsAmount);

        const tx = await web3.eth.getTransaction(result.tx);
        const weiSpent = (new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice));

        const validatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(validator));
        const blockRewardCoinsBalanceAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));

        claimedCoinsAmount.should.be.bignumber.gte(new BN(0));
        validatorCoinsBalanceAfter.should.be.bignumber.equal(validatorCoinsBalanceBefore.add(claimedCoinsAmount).sub(weiSpent));
        blockRewardCoinsBalanceAfter.should.be.bignumber.equal(blockRewardCoinsBalanceBefore.sub(claimedCoinsAmount));
        coinsValidatorsGotForAllEpochs = coinsValidatorsGotForAllEpochs.add(claimedCoinsAmount);
      }

      const blockRewardCoinsBalanceTotalAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));
      blockRewardCoinsBalanceTotalAfter.should.be.bignumber.equal(blockRewardCoinsBalanceTotalBefore.sub(coinsDelegatorGotForAllEpochs).sub(coinsValidatorsGotForAllEpochs));
      blockRewardCoinsBalanceTotalAfter.should.be.bignumber.gte(new BN(0));
    });
  });

  describe('incrementStakingEpoch()', async () => {
    // set ValidatorSet = accounts[7]
    const  validatorSetContract  = accounts[7];
    beforeEach(async () => {
      // set ValidatorSetContract in stakingContract
      await stakingHbbft.setValidatorSetAddress(validatorSetContract).should.be.fulfilled;
    });
    it('should increment if called by the ValidatorSet', async () => {
      (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(new BN(0));
      await stakingHbbft.incrementStakingEpoch({from: validatorSetContract}).should.be.fulfilled;
      (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(new BN(1));
    });
    it('can only be called by ValidatorSet contract', async () => {
      await stakingHbbft.incrementStakingEpoch({from: accounts[8]}).should.be.rejectedWith("Only ValidatorSet");
    });
  });

  describe('initialize()', async () => {

    it('should initialize successfully', async () => {
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        minStake, // _delegatorMinStake
        minStake, // _candidateMinStake
        stakingFixedEpochDuration, // _stakingFixedEpochDuration
        stakingWithdrawDisallowPeriod, // _stakingWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.fulfilled;
      stakingFixedEpochDuration.should.be.bignumber.equal(
        await stakingHbbft.stakingFixedEpochDuration.call()
      );
      stakingWithdrawDisallowPeriod.should.be.bignumber.equal(
        await stakingHbbft.stakingWithdrawDisallowPeriod.call()
      );
      // new BN(0).should.be.bignumber.equal(
      //   await stakingHbbft.stakingEpochStartBlock.call()
      // );
      validatorSetHbbft.address.should.be.equal(
        await stakingHbbft.validatorSetContract.call()
      );
      for (let i = 0; i < initialStakingAddresses.length; i++) {
        new BN(i).should.be.bignumber.equal(
          await stakingHbbft.poolIndex.call(initialStakingAddresses[i])
        );
        true.should.be.equal(
          await stakingHbbft.isPoolActive.call(initialStakingAddresses[i])
        );
        new BN(i).should.be.bignumber.equal(
          await stakingHbbft.poolToBeRemovedIndex.call(initialStakingAddresses[i])
        );
      }
      (await stakingHbbft.getPools.call()).should.be.deep.equal(initialStakingAddresses);
      new BN(web3.utils.toWei('1', 'ether')).should.be.bignumber.equal(
        await stakingHbbft.delegatorMinStake.call()
      );
      new BN(web3.utils.toWei('1', 'ether')).should.be.bignumber.equal(
        await stakingHbbft.candidateMinStake.call()
      );
    });
    it('should fail if ValidatorSet contract address is zero', async () => {
      await stakingHbbft.initialize(
        '0x0000000000000000000000000000000000000000', // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        minStake, // _delegatorMinStake
        minStake, // _candidateMinStake
        stakingFixedEpochDuration, // _stakingFixedEpochDuration
        stakingWithdrawDisallowPeriod, // _stakingWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.rejectedWith("ValidatorSet can't be 0");
    });
    it('should fail if delegatorMinStake is zero', async () => {
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        0, // _delegatorMinStake
        minStake, // _candidateMinStake
        stakingFixedEpochDuration, // _stakingFixedEpochDuration
        stakingWithdrawDisallowPeriod, // _stakingWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.rejectedWith("DelegatorMinStake is 0");
    });
    it('should fail if candidateMinStake is zero', async () => {
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        minStake, // _delegatorMinStake
        0, // _candidateMinStake
        stakingFixedEpochDuration, // _stakingFixedEpochDuration
        stakingWithdrawDisallowPeriod, // _stakingWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.rejectedWith("CandidateMinStake is 0");
    });
    it('should fail if already initialized', async () => {
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        minStake, // _delegatorMinStake
        minStake, // _candidateMinStake
        stakingFixedEpochDuration, // _stakingFixedEpochDuration
        stakingWithdrawDisallowPeriod, // _stakingWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.fulfilled;
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        minStake, // _delegatorMinStake
        minStake, // _candidateMinStake
        3, // _stakingFixedEpochDuration
        stakingWithdrawDisallowPeriod, // _stakingWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.rejectedWith("Already initialized");
    });
    it('should fail if stakingEpochDuration is 0', async () => {
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        minStake, // _delegatorMinStake
        minStake, // _candidateMinStake
        0, // _stakingFixedEpochDuration
        stakingWithdrawDisallowPeriod, // _stakingWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.rejectedWith("FixedEpochDuration is 0");
    });
    it('should fail if stakingstakingEpochStartBlockWithdrawDisallowPeriod is 0', async () => {
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        minStake, // _delegatorMinStake
        minStake, // _candidateMinStake
        stakingFixedEpochDuration, // _stakingFixedEpochDuration
        0, // _stakingWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.rejectedWith("WithdrawDisallowPeriod is 0");
    });
    it('should fail if stakingWithdrawDisallowPeriod >= stakingEpochDuration', async () => {
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        minStake, // _delegatorMinStake
        minStake, // _candidateMinStake
        stakingFixedEpochDuration, // _stakingFixedEpochDuration
        120954, // _stakingWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.rejectedWith("FixedEpochDuration must be longer than withdrawDisallowPeriod");
    });
    it('should fail if some staking address is 0', async () => {
      initialStakingAddresses[0] = '0x0000000000000000000000000000000000000000';
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        minStake, // _delegatorMinStake
        minStake, // _candidateMinStake
        stakingFixedEpochDuration, // _stakingFixedEpochDuration
        stakingWithdrawDisallowPeriod, // _stakingWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.rejectedWith("InitialStakingAddresses can't be 0");
    });
  });

  describe('moveStake()', async () => {
    let delegatorAddress;
    const stakeAmount = minStake.mul(new BN(2));

    beforeEach(async () => {
      delegatorAddress = accounts[7];

      // Initialize StakingHbbft
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        minStake, // _delegatorMinStake
        minStake, // _candidateMinStake
        stakingFixedEpochDuration, // _stakingFixedEpochDuration
        stakingWithdrawDisallowPeriod, // _stakingWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.fulfilled;

      // Place stakes
      //await stakingHbbft.setCurrentBlockNumber(100).should.be.fulfilled;
      //await validatorSetHbbft.setCurrentBlockNumber(100).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[0], {from: initialStakingAddresses[0], value: stakeAmount}).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: stakeAmount}).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[0], {from: delegatorAddress, value: stakeAmount}).should.be.fulfilled;
    });

    it('should move entire stake', async () => {
      await callReward(true);
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[0], delegatorAddress)).should.be.bignumber.equal(stakeAmount);
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(new BN(0));
      await stakingHbbft.moveStake(initialStakingAddresses[0], initialStakingAddresses[1], stakeAmount, {from: delegatorAddress}).should.be.fulfilled;
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[0], delegatorAddress)).should.be.bignumber.equal(new BN(0));
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(stakeAmount);
    });
    it('should move part of the stake', async () => {
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[0], delegatorAddress)).should.be.bignumber.equal(stakeAmount);
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(new BN(0));
      await stakingHbbft.moveStake(initialStakingAddresses[0], initialStakingAddresses[1], minStake, {from: delegatorAddress}).should.be.fulfilled;
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[0], delegatorAddress)).should.be.bignumber.equal(minStake);
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(minStake);
    });
    it('should move part of the stake', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], {from: delegatorAddress, value: stakeAmount}).should.be.fulfilled;

      const sourcePool = initialStakingAddresses[0];
      const targetPool = initialStakingAddresses[1];

      (await stakingHbbft.stakeAmount.call(sourcePool, delegatorAddress)).should.be.bignumber.equal(stakeAmount);
      (await stakingHbbft.stakeAmount.call(targetPool, delegatorAddress)).should.be.bignumber.equal(stakeAmount);

      const moveAmount = minStake.div(new BN(2));
      moveAmount.should.be.bignumber.below(await stakingHbbft.delegatorMinStake.call());

      await stakingHbbft.moveStake(sourcePool, targetPool, moveAmount, {from: delegatorAddress}).should.be.fulfilled;
      (await stakingHbbft.stakeAmount.call(sourcePool, delegatorAddress)).should.be.bignumber.equal(stakeAmount.sub(moveAmount));
      (await stakingHbbft.stakeAmount.call(targetPool, delegatorAddress)).should.be.bignumber.equal(stakeAmount.add(moveAmount));
    });
    it('should fail for zero gas price', async () => {
      await stakingHbbft.moveStake(initialStakingAddresses[0], initialStakingAddresses[1], stakeAmount, {from: delegatorAddress, gasPrice: 0}).should.be.rejectedWith("GasPrice is 0");
    });
    it('should fail if the source and destination addresses are the same', async () => {
      await stakingHbbft.moveStake(initialStakingAddresses[0], initialStakingAddresses[0], stakeAmount, {from: delegatorAddress}).should.be.rejectedWith("MoveStake: src and dst pool is the same");
    });
    it('should fail if the staker tries to move more than they have', async () => {
      await stakingHbbft.moveStake(initialStakingAddresses[0], initialStakingAddresses[1], stakeAmount.mul(new BN(2)), {from: delegatorAddress}).should.be.rejectedWith("Withdraw: maxWithdrawAllowed exceeded.");
    });
  });

  describe('stake()', async () => {
    let delegatorAddress;
    let candidateMinStake;
    let delegatorMinStake;

    beforeEach(async () => {
      delegatorAddress = accounts[7];

      // Deploy StakingHbbft contract
      stakingHbbft = await StakingHbbftCoins.new();
      stakingHbbft = await AdminUpgradeabilityProxy.new(stakingHbbft.address, owner, []);
      stakingHbbft = await StakingHbbftCoins.at(stakingHbbft.address);
      await validatorSetHbbft.setStakingContract(stakingHbbft.address).should.be.fulfilled;

      // Initialize StakingHbbft
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        minStake, // _delegatorMinStake
        minStake, // _candidateMinStake
        stakingFixedEpochDuration, // _stakingFixedEpochDuration
        stakingWithdrawDisallowPeriod, // _stakingWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.fulfilled;

      candidateMinStake = await stakingHbbft.candidateMinStake.call();
      delegatorMinStake = await stakingHbbft.delegatorMinStake.call();

      //await stakingHbbft.setCurrentBlockNumber(100).should.be.fulfilled;
      //await validatorSetHbbft.setCurrentBlockNumber(100).should.be.fulfilled;
    });
    it('should be zero initially', async () => {
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], initialStakingAddresses[1])).should.be.bignumber.equal(new BN(0));
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(new BN(0));
    });
    it('should place a stake', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: candidateMinStake}).should.be.fulfilled;
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], initialStakingAddresses[1])).should.be.bignumber.equal(candidateMinStake);
      const result = await stakingHbbft.stake(initialStakingAddresses[1], {from: delegatorAddress, value: delegatorMinStake}).should.be.fulfilled;
      result.logs[0].event.should.be.equal("PlacedStake");
      result.logs[0].args.toPoolStakingAddress.should.be.equal(initialStakingAddresses[1]);
      result.logs[0].args.staker.should.be.equal(delegatorAddress);
      result.logs[0].args.stakingEpoch.should.be.bignumber.equal(new BN(0));
      result.logs[0].args.amount.should.be.bignumber.equal(delegatorMinStake);
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(delegatorMinStake);
      (await stakingHbbft.stakeAmountTotal.call(initialStakingAddresses[1])).should.be.bignumber.equal(candidateMinStake.add(delegatorMinStake));
    });
    it('should fail for zero gas price', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: candidateMinStake, gasPrice: 0}).should.be.rejectedWith("GasPrice is 0");
    });
    it('should fail for a non-existing pool', async () => {
      await stakingHbbft.stake(accounts[10], {from: delegatorAddress, value: delegatorMinStake}).should.be.rejectedWith("Stake: miningAddress is 0");
      await stakingHbbft.stake('0x0000000000000000000000000000000000000000', {from: delegatorAddress, value: delegatorMinStake}).should.be.rejectedWith("Stake: miningAddress is 0");
    });
    it('should fail for a zero amount', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], {from: delegatorAddress, value: 0}).should.be.rejectedWith("Stake: stakingAmount is 0");
    });
    it('should fail for a banned validator', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: candidateMinStake}).should.be.fulfilled;
      await validatorSetHbbft.setSystemAddress(owner).should.be.fulfilled;
      await validatorSetHbbft.removeMaliciousValidators([initialValidators[1]], {from: owner}).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[1], {from: delegatorAddress, value: delegatorMinStake}).should.be.rejectedWith("Stake: Mining address is banned");
    });
    // it('should only success in the allowed staking window', async () => {
    //   //await stakingHbbft.setCurrentBlockNumber(117000).should.be.fulfilled;
    //   await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: candidateMinStake}).should.be.rejectedWith("Stake: disallowed period");
    // });
    it('should fail if a candidate stakes less than CANDIDATE_MIN_STAKE', async () => {
      const halfOfCandidateMinStake = candidateMinStake.div(new BN(2));
      await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: halfOfCandidateMinStake}).should.be.rejectedWith("Stake: candidateStake less than candidateMinStake");
    });
    it('should fail if a delegator stakes less than DELEGATOR_MIN_STAKE', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: candidateMinStake}).should.be.fulfilled;
      const halfOfDelegatorMinStake = delegatorMinStake.div(new BN(2));
      await stakingHbbft.stake(initialStakingAddresses[1], {from: delegatorAddress, value: halfOfDelegatorMinStake}).should.be.rejectedWith("Stake: delegatorStake is less than delegatorMinStake");
    });
    it('should fail if a delegator stakes into an empty pool', async () => {
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], initialStakingAddresses[1])).should.be.bignumber.equal(new BN(0));
      await stakingHbbft.stake(initialStakingAddresses[1], {from: delegatorAddress, value: delegatorMinStake}).should.be.rejectedWith("Stake: can't delegate in empty pool");
    });
    it('should increase a stake amount', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: candidateMinStake}).should.be.fulfilled;
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(new BN(0));
      await stakingHbbft.stake(initialStakingAddresses[1], {from: delegatorAddress, value: delegatorMinStake}).should.be.fulfilled;
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(delegatorMinStake);
      await stakingHbbft.stake(initialStakingAddresses[1], {from: delegatorAddress, value: delegatorMinStake}).should.be.fulfilled;
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(delegatorMinStake.mul(new BN(2)));
    });
    it('should increase the stakeAmountByCurrentEpoch', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: candidateMinStake}).should.be.fulfilled;
      (await stakingHbbft.stakeAmountByCurrentEpoch.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(new BN(0));
      await stakingHbbft.stake(initialStakingAddresses[1], {from: delegatorAddress, value: delegatorMinStake}).should.be.fulfilled;
      (await stakingHbbft.stakeAmountByCurrentEpoch.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(delegatorMinStake);
      await stakingHbbft.stake(initialStakingAddresses[1], {from: delegatorAddress, value: delegatorMinStake}).should.be.fulfilled;
      (await stakingHbbft.stakeAmountByCurrentEpoch.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(delegatorMinStake.mul(new BN(2)));
    });
    it('should increase a total stake amount', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: candidateMinStake}).should.be.fulfilled;
      (await stakingHbbft.stakeAmountTotal.call(initialStakingAddresses[1])).should.be.bignumber.equal(candidateMinStake);
      await stakingHbbft.stake(initialStakingAddresses[1], {from: delegatorAddress, value: delegatorMinStake}).should.be.fulfilled;
      (await stakingHbbft.stakeAmountTotal.call(initialStakingAddresses[1])).should.be.bignumber.equal(candidateMinStake.add(delegatorMinStake));
      await stakingHbbft.stake(initialStakingAddresses[1], {from: delegatorAddress, value: delegatorMinStake}).should.be.fulfilled;
      (await stakingHbbft.stakeAmountTotal.call(initialStakingAddresses[1])).should.be.bignumber.equal(candidateMinStake.add(delegatorMinStake.mul(new BN(2))));
    });
    it('should add a delegator to the pool', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: candidateMinStake}).should.be.fulfilled;
      (await stakingHbbft.poolDelegators.call(initialStakingAddresses[1])).length.should.be.equal(0);
      await stakingHbbft.stake(initialStakingAddresses[1], {from: delegatorAddress, value: delegatorMinStake}).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[1], {from: delegatorAddress, value: delegatorMinStake}).should.be.fulfilled;
      (await stakingHbbft.poolDelegators.call(initialStakingAddresses[1])).should.be.deep.equal([delegatorAddress]);
    });
    it('should update pool\'s likelihood', async () => {
      let likelihoodInfo = await stakingHbbft.getPoolsLikelihood.call();
      likelihoodInfo.likelihoods.length.should.be.equal(0);
      likelihoodInfo.sum.should.be.bignumber.equal(new BN(0));
      await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: candidateMinStake}).should.be.fulfilled;
      likelihoodInfo = await stakingHbbft.getPoolsLikelihood.call();
      likelihoodInfo.likelihoods[0].should.be.bignumber.equal(candidateMinStake);
      likelihoodInfo.sum.should.be.bignumber.equal(candidateMinStake);
      await stakingHbbft.stake(initialStakingAddresses[1], {from: delegatorAddress, value: delegatorMinStake}).should.be.fulfilled;
      likelihoodInfo = await stakingHbbft.getPoolsLikelihood.call();
      likelihoodInfo.likelihoods[0].should.be.bignumber.equal(candidateMinStake.add(delegatorMinStake));
      likelihoodInfo.sum.should.be.bignumber.equal(candidateMinStake.add(delegatorMinStake));
      await stakingHbbft.stake(initialStakingAddresses[1], {from: delegatorAddress, value: delegatorMinStake}).should.be.fulfilled;
      likelihoodInfo = await stakingHbbft.getPoolsLikelihood.call();
      likelihoodInfo.likelihoods[0].should.be.bignumber.equal(candidateMinStake.add(delegatorMinStake.mul(new BN(2))));
      likelihoodInfo.sum.should.be.bignumber.equal(candidateMinStake.add(delegatorMinStake.mul(new BN(2))));
    });
    it('should decrease the balance of the staker and increase the balance of the Staking contract', async () => {
      (await web3.eth.getBalance(stakingHbbft.address)).should.be.equal('0');
      const initialBalance = new BN(await web3.eth.getBalance(initialStakingAddresses[1]));
      await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: candidateMinStake}).should.be.fulfilled;
      (new BN(await web3.eth.getBalance(initialStakingAddresses[1]))).should.be.bignumber.below(initialBalance.sub(candidateMinStake));
      (new BN(await web3.eth.getBalance(stakingHbbft.address))).should.be.bignumber.equal(candidateMinStake);
    });
  });

  describe('removePool()', async () => {
    beforeEach(async () => {
      // Initialize StakingHbbft
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        minStake, // _delegatorMinStake
        minStake, // _candidateMinStake
        stakingFixedEpochDuration, // _stakingFixedEpochDuration
        stakingWithdrawDisallowPeriod, // _stakingWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.fulfilled;
      //await stakingHbbft.setCurrentBlockNumber(100).should.be.fulfilled;
      //await validatorSetHbbft.setCurrentBlockNumber(100).should.be.fulfilled;
    });

    it('should remove a pool', async () => {
      (await stakingHbbft.getPools.call()).should.be.deep.equal(initialStakingAddresses);
      await stakingHbbft.setValidatorSetAddress(accounts[7]).should.be.fulfilled;
      await stakingHbbft.removePool(initialStakingAddresses[0], {from: accounts[7]}).should.be.fulfilled;
      (await stakingHbbft.getPools.call()).should.be.deep.equal([
        initialStakingAddresses[2],
        initialStakingAddresses[1]
      ]);
      (await stakingHbbft.getPoolsInactive.call()).length.should.be.equal(0);
    });
    it('can only be called by the ValidatorSetHbbft contract', async () => {
      await stakingHbbft.setValidatorSetAddress(accounts[7]).should.be.fulfilled;
      await stakingHbbft.removePool(initialStakingAddresses[0], {from: accounts[8]}).should.be.rejectedWith("Only ValidatorSet");
    });
    it('shouldn\'t fail when removing a nonexistent pool', async () => {
      (await stakingHbbft.getPools.call()).should.be.deep.equal(initialStakingAddresses);
      await stakingHbbft.setValidatorSetAddress(accounts[7]).should.be.fulfilled;
      await stakingHbbft.removePool(accounts[10], {from: accounts[7]}).should.be.fulfilled;
      (await stakingHbbft.getPools.call()).should.be.deep.equal(initialStakingAddresses);
    });
    it('should reset pool index', async () => {
      (await stakingHbbft.poolIndex.call(initialStakingAddresses[1])).should.be.bignumber.equal(new BN(1));
      await stakingHbbft.setValidatorSetAddress(accounts[7]).should.be.fulfilled;
      await stakingHbbft.removePool(initialStakingAddresses[1], {from: accounts[7]}).should.be.fulfilled;
      (await stakingHbbft.poolIndex.call(initialStakingAddresses[1])).should.be.bignumber.equal(new BN(0));
    });
    it('should add/remove a pool to/from the utility lists', async () => {

      const stakeAmount = minStake.mul(new BN(2));

      // The first validator places stake for themselves
      (await stakingHbbft.getPoolsToBeElected.call()).length.should.be.deep.equal(0);
      (await stakingHbbft.getPoolsToBeRemoved.call()).should.be.deep.equal(initialStakingAddresses);
      await stakingHbbft.stake(initialStakingAddresses[0], {from: initialStakingAddresses[0], value: minStake}).should.be.fulfilled;
      (await stakingHbbft.stakeAmountTotal.call(initialStakingAddresses[0])).should.be.bignumber.equal(minStake);
      (await stakingHbbft.getPoolsToBeElected.call()).should.be.deep.equal([initialStakingAddresses[0]]);
      (await stakingHbbft.getPoolsToBeRemoved.call()).should.be.deep.equal([
        initialStakingAddresses[2],
        initialStakingAddresses[1]
      ]);

      // Remove the pool
      await stakingHbbft.setValidatorSetAddress(accounts[7]).should.be.fulfilled;
      (await stakingHbbft.poolInactiveIndex.call(initialStakingAddresses[0])).should.be.bignumber.equal(new BN(0));
      await stakingHbbft.removePool(initialStakingAddresses[0], {from: accounts[7]}).should.be.fulfilled;
      (await stakingHbbft.getPoolsInactive.call()).should.be.deep.equal([initialStakingAddresses[0]]);
      (await stakingHbbft.poolInactiveIndex.call(initialStakingAddresses[0])).should.be.bignumber.equal(new BN(0));

      await stakingHbbft.setStakeAmountTotal(initialStakingAddresses[0], 0);
      await stakingHbbft.removePool(initialStakingAddresses[0], {from: accounts[7]}).should.be.fulfilled;
      (await stakingHbbft.getPoolsInactive.call()).length.should.be.equal(0);
      (await stakingHbbft.getPoolsToBeElected.call()).length.should.be.deep.equal(0);

      (await stakingHbbft.poolToBeRemovedIndex.call(initialStakingAddresses[1])).should.be.bignumber.equal(new BN(1));
      await stakingHbbft.removePool(initialStakingAddresses[1], {from: accounts[7]}).should.be.fulfilled;
      (await stakingHbbft.getPoolsToBeRemoved.call()).should.be.deep.equal([initialStakingAddresses[2]]);
      (await stakingHbbft.poolToBeRemovedIndex.call(initialStakingAddresses[1])).should.be.bignumber.equal(new BN(0));
    });
  });

  describe('removeMyPool()', async () => {
    beforeEach(async () => {
      // Initialize StakingHbbft
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        minStake, // _delegatorMinStake
        minStake, // _candidateMinStake
        stakingFixedEpochDuration, // _stakingFixedEpochDuration
        stakingWithdrawDisallowPeriod, // _stakingWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.fulfilled;
      //await stakingHbbft.setCurrentBlockNumber(100).should.be.fulfilled;
    });

    it('should fail for zero gas price', async () => {
      await stakingHbbft.setValidatorSetAddress(accounts[7]).should.be.fulfilled;
      await stakingHbbft.incrementStakingEpoch({from: accounts[7]}).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
      await stakingHbbft.removeMyPool({from: initialStakingAddresses[0], gasPrice: 0}).should.be.rejectedWith("GasPrice is 0");
    });
    it('should fail if Staking contract is not initialized', async () => {
      await stakingHbbft.setValidatorSetAddress(accounts[7]).should.be.fulfilled;
      await stakingHbbft.incrementStakingEpoch({from: accounts[7]}).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress('0x0000000000000000000000000000000000000000').should.be.fulfilled;
      await stakingHbbft.removeMyPool({from: initialStakingAddresses[0]}).should.be.rejectedWith("Contract not initialized");
      await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
      await stakingHbbft.removeMyPool({from: initialStakingAddresses[0]}).should.be.fulfilled;
    });
    it('should fail for initial validator during the initial staking epoch', async () => {
      (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(new BN(0));
      (await validatorSetHbbft.isValidator.call(initialValidators[0])).should.be.equal(true);
      (await validatorSetHbbft.miningByStakingAddress.call(initialStakingAddresses[0])).should.be.equal(initialValidators[0]);
      await stakingHbbft.removeMyPool({from: initialStakingAddresses[0]}).should.be.rejectedWith("Can't remove pool during 1st staking epoch");
      await stakingHbbft.setValidatorSetAddress(accounts[7]).should.be.fulfilled;
      await stakingHbbft.incrementStakingEpoch({from: accounts[7]}).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
      await stakingHbbft.removeMyPool({from: initialStakingAddresses[0]}).should.be.fulfilled
    });
  });

  describe('withdraw()', async () => {
    let delegatorAddress;
    let candidateMinStake;
    let delegatorMinStake;

    const stakeAmount = minStake.mul(new BN(2));

    beforeEach(async () => {
      delegatorAddress = accounts[7];

      // Initialize StakingHbbft
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        minStake, // _delegatorMinStake
        minStake, // _candidateMinStake
        stakingFixedEpochDuration, // _stakingFixedEpochDuration
        stakingWithdrawDisallowPeriod, // _stakingWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.fulfilled;

      candidateMinStake = await stakingHbbft.candidateMinStake.call();
      delegatorMinStake = await stakingHbbft.delegatorMinStake.call();

      //await stakingHbbft.setCurrentBlockNumber(100).should.be.fulfilled;
     // //await validatorSetHbbft.setCurrentBlockNumber(100).should.be.fulfilled;
    });

    it('should withdraw a stake', async () => {
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], initialStakingAddresses[1])).should.be.bignumber.equal(new BN(0));
      (await stakingHbbft.stakeAmountByCurrentEpoch.call(initialStakingAddresses[1], initialStakingAddresses[1])).should.be.bignumber.equal(new BN(0));
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(new BN(0));
      (await stakingHbbft.stakeAmountByCurrentEpoch.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(new BN(0));
      await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: stakeAmount}).should.be.fulfilled;
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], initialStakingAddresses[1])).should.be.bignumber.equal(stakeAmount);
      (await stakingHbbft.stakeAmountByCurrentEpoch.call(initialStakingAddresses[1], initialStakingAddresses[1])).should.be.bignumber.equal(stakeAmount);

      await stakingHbbft.stake(initialStakingAddresses[1], {from: delegatorAddress, value: stakeAmount}).should.be.fulfilled;
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(stakeAmount);
      (await stakingHbbft.stakeAmountByCurrentEpoch.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(stakeAmount);
      (await stakingHbbft.stakeAmountTotal.call(initialStakingAddresses[1])).should.be.bignumber.equal(stakeAmount.mul(new BN(2)));

      const result = await stakingHbbft.withdraw(initialStakingAddresses[1], stakeAmount, {from: delegatorAddress}).should.be.fulfilled;
      result.logs[0].event.should.be.equal("WithdrewStake");
      result.logs[0].args.fromPoolStakingAddress.should.be.equal(initialStakingAddresses[1]);
      result.logs[0].args.staker.should.be.equal(delegatorAddress);
      result.logs[0].args.stakingEpoch.should.be.bignumber.equal(new BN(0));
      result.logs[0].args.amount.should.be.bignumber.equal(stakeAmount);
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(new BN(0));
      (await stakingHbbft.stakeAmountByCurrentEpoch.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(new BN(0));
      (await stakingHbbft.stakeAmountTotal.call(initialStakingAddresses[1])).should.be.bignumber.equal(stakeAmount);
    });
    it('should fail for zero gas price', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: stakeAmount}).should.be.fulfilled;
      await stakingHbbft.withdraw(initialStakingAddresses[1], stakeAmount, {from: initialStakingAddresses[1], gasPrice: 0}).should.be.rejectedWith("GasPrice is 0");
    });
    it('should fail if not initialized', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: stakeAmount}).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress('0x0000000000000000000000000000000000000000').should.be.fulfilled;
      await stakingHbbft.withdraw(initialStakingAddresses[1], stakeAmount, {from: initialStakingAddresses[1]}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
      await stakingHbbft.withdraw(initialStakingAddresses[1], stakeAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
    });
    it('should fail for a zero pool address', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: stakeAmount}).should.be.fulfilled;
      await stakingHbbft.withdraw('0x0000000000000000000000000000000000000000', stakeAmount, {from: initialStakingAddresses[1]}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.withdraw(initialStakingAddresses[1], stakeAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
    });
    it('should fail for a zero amount', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: stakeAmount}).should.be.fulfilled;
      await stakingHbbft.withdraw(initialStakingAddresses[1], new BN(0), {from: initialStakingAddresses[1]}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.withdraw(initialStakingAddresses[1], stakeAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
    });
    it('shouldn\'t allow withdrawing from a banned pool', async () => {

      await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: stakeAmount}).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[1], {from: delegatorAddress, value: stakeAmount}).should.be.fulfilled;
      await validatorSetHbbft.setBannedUntil(initialValidators[1], 100).should.be.fulfilled;
      await stakingHbbft.withdraw(initialStakingAddresses[1], stakeAmount, {from: initialStakingAddresses[1]}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.withdraw(initialStakingAddresses[1], stakeAmount, {from: delegatorAddress}).should.be.rejectedWith(ERROR_MSG);
      await validatorSetHbbft.setBannedUntil(initialValidators[1], 0).should.be.fulfilled;
      await stakingHbbft.withdraw(initialStakingAddresses[1], stakeAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
      await stakingHbbft.withdraw(initialStakingAddresses[1], stakeAmount, {from: delegatorAddress}).should.be.fulfilled;
    });
    // it('shouldn\'t allow withdrawing during the stakingWithdrawDisallowPeriod', async () => {
    //   await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: stakeAmount}).should.be.fulfilled;
    //   //await stakingHbbft.setCurrentBlockNumber(117000).should.be.fulfilled;
    //   //await validatorSetHbbft.setCurrentBlockNumber(117000).should.be.fulfilled;
    //   await stakingHbbft.withdraw(initialStakingAddresses[1], stakeAmount, {from: initialStakingAddresses[1]}).should.be.rejectedWith(ERROR_MSG);
    //   //await stakingHbbft.setCurrentBlockNumber(116000).should.be.fulfilled;
    //   //await validatorSetHbbft.setCurrentBlockNumber(116000).should.be.fulfilled;
    //   await stakingHbbft.withdraw(initialStakingAddresses[1], stakeAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
    // });
    it('should fail if non-zero residue is less than CANDIDATE_MIN_STAKE', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: stakeAmount}).should.be.fulfilled;
      await stakingHbbft.withdraw(initialStakingAddresses[1], stakeAmount.sub(candidateMinStake).add(new BN(1)), {from: initialStakingAddresses[1]}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.withdraw(initialStakingAddresses[1], stakeAmount.sub(candidateMinStake), {from: initialStakingAddresses[1]}).should.be.fulfilled;
      await stakingHbbft.withdraw(initialStakingAddresses[1], candidateMinStake, {from: initialStakingAddresses[1]}).should.be.fulfilled;
    });
    it('should fail if non-zero residue is less than DELEGATOR_MIN_STAKE', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: stakeAmount}).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[1], {from: delegatorAddress, value: stakeAmount}).should.be.fulfilled;
      await stakingHbbft.withdraw(initialStakingAddresses[1], stakeAmount.sub(delegatorMinStake).add(new BN(1)), {from: delegatorAddress}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.withdraw(initialStakingAddresses[1], stakeAmount.sub(delegatorMinStake), {from: delegatorAddress}).should.be.fulfilled;
      await stakingHbbft.withdraw(initialStakingAddresses[1], delegatorMinStake, {from: delegatorAddress}).should.be.fulfilled;
    });
    it('should fail if withdraw more than staked', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: stakeAmount}).should.be.fulfilled;
      await stakingHbbft.withdraw(initialStakingAddresses[1], stakeAmount.add(new BN(1)), {from: initialStakingAddresses[1]}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.withdraw(initialStakingAddresses[1], stakeAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
    });
    it('should fail if withdraw already ordered amount', async () => {
      //await validatorSetHbbft.setCurrentBlockNumber(1).should.be.fulfilled;
      await validatorSetHbbft.setSystemAddress(owner).should.be.fulfilled;
      await validatorSetHbbft.finalizeChange({from: owner}).should.be.fulfilled;
      //await validatorSetHbbft.setCurrentBlockNumber(100).should.be.fulfilled;

      // Place a stake during the initial staking epoch
      (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(new BN(0));
      await stakingHbbft.stake(initialStakingAddresses[0], {from: initialStakingAddresses[0], value: stakeAmount}).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: stakeAmount}).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[2], {from: initialStakingAddresses[2], value: stakeAmount}).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[1], {from: delegatorAddress, value: stakeAmount}).should.be.fulfilled;

      // Finalize a new validator set and change staking epoch
      //await stakingHbbft.setCurrentBlockNumber(120954).should.be.fulfilled;
      //await validatorSetHbbft.setCurrentBlockNumber(120954).should.be.fulfilled;
      await blockRewardHbbft.initialize(validatorSetHbbft.address, maxEpochReward).should.be.fulfilled;      
      await validatorSetHbbft.setStakingContract(stakingHbbft.address).should.be.fulfilled;
      // Set BlockRewardContract
      await validatorSetHbbft.setBlockRewardContract(accounts[7]).should.be.fulfilled;
      await validatorSetHbbft.newValidatorSet({from: accounts[7]}).should.be.fulfilled;
      await validatorSetHbbft.setBlockRewardContract(blockRewardHbbft.address).should.be.fulfilled;
      // Finalize change (increases staking epoch)
      await validatorSetHbbft.finalizeChange({from: owner}).should.be.fulfilled;
      //await stakingHbbft.setCurrentBlockNumber(120970).should.be.fulfilled;
      //await validatorSetHbbft.setCurrentBlockNumber(120970).should.be.fulfilled;
      (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(new BN(1));
      // Order withdrawal
      const orderedAmount = stakeAmount.div(new BN(4));
      await stakingHbbft.orderWithdraw(initialStakingAddresses[1], orderedAmount, {from: delegatorAddress}).should.be.fulfilled;
      // The second validator removes their pool
      (await validatorSetHbbft.isValidator.call(initialValidators[1])).should.be.equal(true);
      (await stakingHbbft.getPoolsInactive.call()).length.should.be.equal(0);
      await stakingHbbft.removeMyPool({from: initialStakingAddresses[1]}).should.be.fulfilled;
      (await stakingHbbft.getPoolsInactive.call()).should.be.deep.equal([initialStakingAddresses[1]]);

      // Finalize a new validator set, change staking epoch and enqueue pending validators
      //await stakingHbbft.setCurrentBlockNumber(120954*2).should.be.fulfilled;
      //await validatorSetHbbft.setCurrentBlockNumber(120954*2).should.be.fulfilled;
      await validatorSetHbbft.setBlockRewardContract(accounts[7]).should.be.fulfilled;
      await validatorSetHbbft.newValidatorSet({from: accounts[7]}).should.be.fulfilled;
      await validatorSetHbbft.setBlockRewardContract(blockRewardHbbft.address).should.be.fulfilled;
      await validatorSetHbbft.finalizeChange({from: owner}).should.be.fulfilled;
      //await stakingHbbft.setCurrentBlockNumber(120970*2).should.be.fulfilled;
      //await validatorSetHbbft.setCurrentBlockNumber(120970*2).should.be.fulfilled;
      (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(new BN(2));
      (await validatorSetHbbft.isValidator.call(initialValidators[1])).should.be.equal(false);

      // Check withdrawal for a delegator
      const restOfAmount = stakeAmount.mul(new BN(3)).div(new BN(4));
      (await stakingHbbft.poolDelegators.call(initialStakingAddresses[1])).should.be.deep.equal([delegatorAddress]);
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(restOfAmount);
      (await stakingHbbft.stakeAmountByCurrentEpoch.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(new BN(0));
      await stakingHbbft.withdraw(initialStakingAddresses[1], stakeAmount, {from: delegatorAddress}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.withdraw(initialStakingAddresses[1], restOfAmount.add(new BN(1)), {from: delegatorAddress}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.withdraw(initialStakingAddresses[1], restOfAmount, {from: delegatorAddress}).should.be.fulfilled;
      (await stakingHbbft.stakeAmountByCurrentEpoch.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(new BN(0));
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(new BN(0));
      (await stakingHbbft.orderedWithdrawAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(orderedAmount);
      (await stakingHbbft.poolDelegators.call(initialStakingAddresses[1])).length.should.be.equal(0);
      (await stakingHbbft.poolDelegatorsInactive.call(initialStakingAddresses[1])).should.be.deep.equal([delegatorAddress]);
    });
    it('should decrease likelihood', async () => {
      let likelihoodInfo = await stakingHbbft.getPoolsLikelihood.call();
      likelihoodInfo.sum.should.be.bignumber.equal(new BN(0));

      await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: stakeAmount}).should.be.fulfilled;

      likelihoodInfo = await stakingHbbft.getPoolsLikelihood.call();
      likelihoodInfo.likelihoods[0].should.be.bignumber.equal(stakeAmount);
      likelihoodInfo.sum.should.be.bignumber.equal(stakeAmount);

      await stakingHbbft.withdraw(initialStakingAddresses[1], stakeAmount.div(new BN(2)), {from: initialStakingAddresses[1]}).should.be.fulfilled;

      likelihoodInfo = await stakingHbbft.getPoolsLikelihood.call();
      likelihoodInfo.likelihoods[0].should.be.bignumber.equal(stakeAmount.div(new BN(2)));
      likelihoodInfo.sum.should.be.bignumber.equal(stakeAmount.div(new BN(2)));
    });
    // TODO: add unit tests for native coin withdrawal
  });

  // TODO: ...add other tests...

  async function callFinalizeChange() {
    await validatorSetHbbft.setSystemAddress(owner).should.be.fulfilled;
    await validatorSetHbbft.finalizeChange({from: owner}).should.be.fulfilled;
    await validatorSetHbbft.setSystemAddress('0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE').should.be.fulfilled;
  }

  async function callReward(isEpochEndBlock) {
    const validators = await validatorSetHbbft.getValidators.call();
    await blockRewardHbbft.setSystemAddress(owner).should.be.fulfilled;
    increaseTime(2);
    const {logs} = await blockRewardHbbft.reward([validators[0]], [0], isEpochEndBlock, {from: owner}).should.be.fulfilled;
    // Emulate minting native coins
    logs[0].event.should.be.equal("CoinsRewarded");
    const totalReward = logs[0].args.rewards;
    await blockRewardHbbft.sendCoins({from: owner, value: totalReward}).should.be.fulfilled;
    await blockRewardHbbft.setSystemAddress('0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE').should.be.fulfilled;
  }

  async function increaseTime(time) {
    
    const currentTimestamp = await validatorSetHbbft.getCurrentTimestamp.call();
    const futureTimestamp = currentTimestamp.add(web3.utils.toBN(time));
    await validatorSetHbbft.setCurrentTimestamp(futureTimestamp);
    const currentTimestampAfter = await validatorSetHbbft.getCurrentTimestamp.call();
    futureTimestamp.should.be.bignumber.equal(currentTimestampAfter);
  }

  // async function setCurrentBlockNumber(blockNumber) {
  //   await blockRewardHbbft.setCurrentBlockNumber(blockNumber).should.be.fulfilled;
  //   await randomHbbft.setCurrentBlockNumber(blockNumber).should.be.fulfilled;
  //   await stakingHbbft.setCurrentBlockNumber(blockNumber).should.be.fulfilled;
  //   //await validatorSetHbbft.setCurrentBlockNumber(blockNumber).should.be.fulfilled;
  // }
});

function random(low, high) {
  return Math.floor(Math.random() * (high - low) + low);
}

function shuffle(a) {
  var j, x, i;
  for (i = a.length - 1; i > 0; i--) {
    j = Math.floor(Math.random() * (i + 1));
    x = a[i];
    a[i] = a[j];
    a[j] = x;
  }
  return a;
}

