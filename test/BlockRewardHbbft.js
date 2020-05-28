const BlockRewardHbbft = artifacts.require('BlockRewardHbbftCoinsMock');
const AdminUpgradeabilityProxy = artifacts.require('AdminUpgradeabilityProxy');
const RandomHbbft = artifacts.require('RandomHbbftMock');
const ValidatorSetHbbft = artifacts.require('ValidatorSetHbbftMock');
const StakingHbbft = artifacts.require('StakingHbbftCoinsMock');
const KeyGenHistory = artifacts.require('KeyGenHistory');

const ERROR_MSG = 'VM Exception while processing transaction: revert';
const BN = web3.utils.BN;

const fp = require('lodash/fp');
require('chai')
  .use(require('chai-as-promised'))
  .use(require('chai-bn')(BN))
  .should();

contract('BlockRewardHbbft', async accounts => {
  let owner;
  let blockRewardHbbft;
  let randomHbbft;
  let stakingHbbft;
  let validatorSetHbbft;
  let candidateMinStake;
  let delegatorMinStake;
  let nativeRewardUndistributed = new BN(0);
  let initialValidatorsPubKeys;
  let initialValidatorsIpAddresses;

  const COLLECT_ROUND_LENGTH = 114;
  const STAKING_FIXED_EPOCH_DURATION = new BN(120954);
  const STAKING_EPOCH_DURATION = new BN(120954 + 2);
  const STAKING_EPOCH_START_BLOCK = new BN(120954 * 10 + 1);
  const KEY_GEN_DURATION = new BN(2); // we assume that there is a fixed duration in blocks, in reality it varies.
  const STAKE_WITHDRAW_DISALLOW_PERIOD = 4320;
  const MIN_STAKE = new BN(web3.utils.toWei('1', 'ether'));
  const MAX_BLOCK_REWARD = new BN(100); // the maximum  per-block reward distributed to the validators

  describe('reward()', async () => {
    it('network started', async () => {
      owner = accounts[0];

      const initialValidators = accounts.slice(1, 3 + 1); // accounts[1...3]
      const initialStakingAddresses = accounts.slice(4, 6 + 1); // accounts[4...6]
      initialStakingAddresses.length.should.be.equal(3);
      initialStakingAddresses[0].should.not.be.equal('0x0000000000000000000000000000000000000000');
      initialStakingAddresses[1].should.not.be.equal('0x0000000000000000000000000000000000000000');
      initialStakingAddresses[2].should.not.be.equal('0x0000000000000000000000000000000000000000');
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
      // Deploy ValidatorSetHbbft contract
      validatorSetHbbft = await ValidatorSetHbbft.new();
      validatorSetHbbft = await AdminUpgradeabilityProxy.new(validatorSetHbbft.address, owner, []);
      validatorSetHbbft = await ValidatorSetHbbft.at(validatorSetHbbft.address);

      keyGenHistory = await KeyGenHistory.new();
      keyGenHistory = await AdminUpgradeabilityProxy.new(keyGenHistory.address, owner, []);
      keyGenHistory = await KeyGenHistory.at(keyGenHistory.address);

      await keyGenHistory.initialize(validatorSetHbbft.address, initialValidators, [[0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,181,129,31,84,186,242,5,151,59,35,196,140,106,29,40,112,142,156,132,158,47,223,253,185,227,249,190,96,5,99,239,213,127,29,136,115,71,164,202,44,6,171,131,251,147,159,54,49,1,0,0,0,0,0,0,0,153,0,0,0,0,0,0,0,4,177,133,61,18,58,222,74,65,5,126,253,181,113,165,43,141,56,226,132,208,218,197,119,179,128,30,162,251,23,33,73,38,120,246,223,233,11,104,60,154,241,182,147,219,81,45,134,239,69,169,198,188,152,95,254,170,108,60,166,107,254,204,195,170,234,154,134,26,91,9,139,174,178,248,60,65,196,218,46,163,218,72,1,98,12,109,186,152,148,159,121,254,34,112,51,70,121,51,167,35,240,5,134,197,125,252,3,213,84,70,176,160,36,73,140,104,92,117,184,80,26,240,106,230,241,26,79,46,241,195,20,106,12,186,49,254,168,233,25,179,96,62,104,118,153,95,53,127,160,237,246,41],[0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,181,129,31,84,186,242,5,151,59,35,196,140,106,29,40,112,142,156,132,158,47,223,253,185,227,249,190,96,5,99,239,213,127,29,136,115,71,164,202,44,6,171,131,251,147,159,54,49,1,0,0,0,0,0,0,0,153,0,0,0,0,0,0,0,4,177,133,61,18,58,222,74,65,5,126,253,181,113,165,43,141,56,226,132,208,218,197,119,179,128,30,162,251,23,33,73,38,120,246,223,233,11,104,60,154,241,182,147,219,81,45,134,239,69,169,198,188,152,95,254,170,108,60,166,107,254,204,195,170,234,154,134,26,91,9,139,174,178,248,60,65,196,218,46,163,218,72,1,98,12,109,186,152,148,159,121,254,34,112,51,70,121,51,167,35,240,5,134,197,125,252,3,213,84,70,176,160,36,73,140,104,92,117,184,80,26,240,106,230,241,26,79,46,241,195,20,106,12,186,49,254,168,233,25,179,96,62,104,118,153,95,53,127,160,237,246,41],[0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,181,129,31,84,186,242,5,151,59,35,196,140,106,29,40,112,142,156,132,158,47,223,253,185,227,249,190,96,5,99,239,213,127,29,136,115,71,164,202,44,6,171,131,251,147,159,54,49,1,0,0,0,0,0,0,0,153,0,0,0,0,0,0,0,4,177,133,61,18,58,222,74,65,5,126,253,181,113,165,43,141,56,226,132,208,218,197,119,179,128,30,162,251,23,33,73,38,120,246,223,233,11,104,60,154,241,182,147,219,81,45,134,239,69,169,198,188,152,95,254,170,108,60,166,107,254,204,195,170,234,154,134,26,91,9,139,174,178,248,60,65,196,218,46,163,218,72,1,98,12,109,186,152,148,159,121,254,34,112,51,70,121,51,167,35,240,5,134,197,125,252,3,213,84,70,176,160,36,73,140,104,92,117,184,80,26,240,106,230,241,26,79,46,241,195,20,106,12,186,49,254,168,233,25,179,96,62,104,118,153,95,53,127,160,237,246,41]],
      [[[0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,145,0,0,0,0,0,0,0,4,239,1,112,13,13,251,103,186,212,78,44,47,250,221,84,118,88,7,64,206,186,11,2,8,204,140,106,179,52,251,237,19,53,74,187,217,134,94,66,68,89,42,85,207,155,220,101,223,51,199,37,38,203,132,13,77,78,114,53,219,114,93,21,25,164,12,43,252,160,16,23,111,79,230,121,95,223,174,211,172,231,0,52,25,49,152,79,128,39,117,216,85,201,237,242,151,219,149,214,77,233,145,47,10,184,175,162,174,237,177,131,45,126,231,32,147,227,170,125,133,36,123,164,232,129,135,196,136,186,45,73,226,179,169,147,42,41,140,202,191,12,73,146,2]],[[0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,145,0,0,0,0,0,0,0,4,239,1,112,13,13,251,103,186,212,78,44,47,250,221,84,118,88,7,64,206,186,11,2,8,204,140,106,179,52,251,237,19,53,74,187,217,134,94,66,68,89,42,85,207,155,220,101,223,51,199,37,38,203,132,13,77,78,114,53,219,114,93,21,25,164,12,43,252,160,16,23,111,79,230,121,95,223,174,211,172,231,0,52,25,49,152,79,128,39,117,216,85,201,237,242,151,219,149,214,77,233,145,47,10,184,175,162,174,237,177,131,45,126,231,32,147,227,170,125,133,36,123,164,232,129,135,196,136,186,45,73,226,179,169,147,42,41,140,202,191,12,73,146,2]],[[0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,145,0,0,0,0,0,0,0,4,239,1,112,13,13,251,103,186,212,78,44,47,250,221,84,118,88,7,64,206,186,11,2,8,204,140,106,179,52,251,237,19,53,74,187,217,134,94,66,68,89,42,85,207,155,220,101,223,51,199,37,38,203,132,13,77,78,114,53,219,114,93,21,25,164,12,43,252,160,16,23,111,79,230,121,95,223,174,211,172,231,0,52,25,49,152,79,128,39,117,216,85,201,237,242,151,219,149,214,77,233,145,47,10,184,175,162,174,237,177,131,45,126,231,32,147,227,170,125,133,36,123,164,232,129,135,196,136,186,45,73,226,179,169,147,42,41,140,202,191,12,73,146,2]]]
      ).should.be.fulfilled;
      // The following private keys belong to the accounts 1-3, fixed by using the "--mnemonic" option when starting ganache.
      // const initialValidatorsPrivKeys = ["0x272b8400a202c08e23641b53368d603e5fec5c13ea2f438bce291f7be63a02a7", "0xa8ea110ffc8fe68a069c8a460ad6b9698b09e21ad5503285f633b3ad79076cf7", "0x5da461ff1378256f69cb9a9d0a8b370c97c460acbe88f5d897cb17209f891ffc"];
      // Public keys corresponding to the three private keys above.
      initialValidatorsPubKeys = fp.flatMap(x => [x.substring(0, 66), '0x' + x.substring(66, 130)])
        (['0x52be8f332b0404dff35dd0b2ba44993a9d3dc8e770b9ce19a849dff948f1e14c57e7c8219d522c1a4cce775adbee5330f222520f0afdabfdb4a4501ceeb8dcee',
          '0x99edf3f524a6f73e7f5d561d0030fc6bcc3e4bd33971715617de7791e12d9bdf6258fa65b74e7161bbbf7ab36161260f56f68336a6f65599dc37e7f2e397f845',
          '0xa255fd7ad199f0ee814ee00cce44ef2b1fa1b52eead5d8013ed85eade03034ae4c246658946c2e1d7ded96394a1247fb4d093c32474317ae388e8d25692a0f56']);
      // The IP addresses are irrelevant for these unit test, just initialize them to 0.
      initialValidatorsIpAddresses = ['0x00000000000000000000000000000000', '0x00000000000000000000000000000000', '0x00000000000000000000000000000000'];

      // Initialize ValidatorSetHbbft
      await validatorSetHbbft.initialize(
        blockRewardHbbft.address, // _blockRewardContract
        randomHbbft.address, // _randomContract
        stakingHbbft.address, // _stakingContract
        keyGenHistory.address, //_keyGenHistoryContract
        initialValidators, // _initialMiningAddresses
        initialStakingAddresses, // _initialStakingAddresses
      ).should.be.fulfilled;

      // Initialize StakingHbbft
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        MIN_STAKE, // _delegatorMinStake
        MIN_STAKE, // _candidateMinStake
        STAKING_FIXED_EPOCH_DURATION, // _stakingFixedEpochDuration,
        STAKING_EPOCH_START_BLOCK, // _stakingEpochStartBlock
        STAKE_WITHDRAW_DISALLOW_PERIOD, // _stakeWithdrawDisallowPeriod
        initialValidatorsPubKeys, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.fulfilled;

      candidateMinStake = await stakingHbbft.candidateMinStake.call();
      delegatorMinStake = await stakingHbbft.delegatorMinStake.call();

      // Initialize BlockRewardHbbft
      await blockRewardHbbft.initialize(
        validatorSetHbbft.address,
        MAX_BLOCK_REWARD
      ).should.be.fulfilled;

      // Initialize RandomHbbft
      await randomHbbft.initialize(
        validatorSetHbbft.address
      ).should.be.fulfilled;

      // Start the network
      await setCurrentBlockNumber(0);

    });

    it('staking epoch #0 finished', async () => {
      const stakingEpoch = await stakingHbbft.stakingEpoch.call();
      stakingEpoch.should.be.bignumber.equal(new BN(0));

      const stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
      stakingEpochStartBlock.should.be.bignumber.equal(STAKING_EPOCH_START_BLOCK);

      const stakingFixedEpochEndBlock = await stakingHbbft.stakingFixedEpochEndBlock.call();
      await setCurrentBlockNumber(stakingFixedEpochEndBlock);
      await callReward(false);
      
      const endBlock = stakingEpochStartBlock.add(STAKING_FIXED_EPOCH_DURATION).add(new BN(2)).sub(new BN(1)); // +2 for the keyGen duration
      const stakingEpochEndBlock = stakingFixedEpochEndBlock.add(KEY_GEN_DURATION);
      stakingEpochEndBlock.should.be.bignumber.equal(endBlock);
      const startBlock = stakingEpochEndBlock.add(new BN(1)); // upcoming epoch's start block
      await setCurrentBlockNumber(stakingEpochEndBlock);


      await callReward(true);
      await callFinalizeChange();
      (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(new BN(1));
      (await stakingHbbft.stakingEpochStartBlock.call()).should.be.bignumber.equal(startBlock);
      (await blockRewardHbbft.nativeRewardUndistributed.call()).should.be.bignumber.equal(nativeRewardUndistributed);
    });

    it('staking epoch #1 started', async () => {
      (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(new BN(1));
      const stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
      stakingEpochStartBlock.should.be.bignumber.equal(STAKING_EPOCH_START_BLOCK.add(STAKING_FIXED_EPOCH_DURATION).add(KEY_GEN_DURATION));
      await setCurrentBlockNumber(stakingEpochStartBlock);

      const pendingValidators = await validatorSetHbbft.getPendingValidators.call();
      pendingValidators.length.should.be.equal(0);

      const validators = await validatorSetHbbft.getValidators.call();
      validators.length.should.be.equal(3);
    });

    it('validators and their delegators place stakes during the epoch #1', async () => {
      const validators = await validatorSetHbbft.getValidators.call();

      for (let i = 0; i < validators.length; i++) {
        const stakingAddress = await validatorSetHbbft.stakingByMiningAddress.call(validators[i]);
        // Validator places stake on themselves
        await stakingHbbft.stake(stakingAddress, {from: stakingAddress, value: candidateMinStake}).should.be.fulfilled;

        const delegatorsLength = 3;
        const delegators = accounts.slice(11 + i*delegatorsLength, 11 + i*delegatorsLength + delegatorsLength);
        for (let j = 0; j < delegators.length; j++) {
          // Delegator places stake on the validator
          await stakingHbbft.stake(stakingAddress, {from: delegators[j], value: delegatorMinStake}).should.be.fulfilled;
        }
      }
    });

    it('staking epoch #1 finished', async () => {
      const stakingEpoch = await stakingHbbft.stakingEpoch.call();
      stakingEpoch.should.be.bignumber.equal(new BN(1));

      const stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
      stakingEpochStartBlock.should.be.bignumber.equal(STAKING_EPOCH_START_BLOCK.add(STAKING_EPOCH_DURATION));

      (await validatorSetHbbft.getPendingValidators.call()).length.should.be.equal(0);

      const stakingFixedEpochEndBlock = await stakingHbbft.stakingFixedEpochEndBlock.call();
      await setCurrentBlockNumber(stakingFixedEpochEndBlock);
      await callReward(false);

      const endBlock = stakingEpochStartBlock.add(STAKING_FIXED_EPOCH_DURATION).add(new BN(2)).sub(new BN(1)); // +2 for the keyGen duration
      const stakingEpochEndBlock = stakingFixedEpochEndBlock.add(KEY_GEN_DURATION);
      stakingEpochEndBlock.should.be.bignumber.equal(endBlock);
      const startBlock = stakingEpochEndBlock.add(new BN(1)); // upcoming epoch's start block
      await setCurrentBlockNumber(stakingEpochEndBlock);

      const blocksCreated = stakingEpochEndBlock.sub(await stakingHbbft.stakingEpochStartBlock.call());
      blocksCreated.should.be.bignumber.equal(STAKING_FIXED_EPOCH_DURATION.add(KEY_GEN_DURATION).sub(new BN(1))); //-1 because it is gonna be increased by blockRewardHbbft.reward()
      await blockRewardHbbft.setBlocksCreated(stakingEpoch, blocksCreated).should.be.fulfilled;

      await callReward(true);
      (await blockRewardHbbft.blocksCreated.call(stakingEpoch)).should.be.bignumber.equal(STAKING_EPOCH_DURATION);
      let pendingValidators = await validatorSetHbbft.getPendingValidators.call();
      pendingValidators.sortedEqual([
        accounts[1],
        accounts[2],
        accounts[3]
      ]);

      await callFinalizeChange();
      const nextStakingEpoch = stakingEpoch.add(new BN(1));
      (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(nextStakingEpoch);
      (await blockRewardHbbft.blocksCreated.call(stakingEpoch)).should.be.bignumber.equal('0'); //finalizeChange should clear blocksCreated

      (await blockRewardHbbft.nativeRewardUndistributed.call()).should.be.bignumber.equal(nativeRewardUndistributed);

      // pending validators get deleted after being finalized
      (await validatorSetHbbft.getPendingValidators.call()).length.should.be.equal(0);

      validators = await validatorSetHbbft.getValidators.call();
      validators.sortedEqual([
        accounts[1],
        accounts[2],
        accounts[3]
      ]);
      for (let i = 0; i < validators.length; i++) {
        (await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(nextStakingEpoch, validators[i])).should.be.bignumber.equal(
          candidateMinStake
        );
        (await blockRewardHbbft.snapshotPoolTotalStakeAmount.call(nextStakingEpoch, validators[i])).should.be.bignumber.equal(
          candidateMinStake.add(delegatorMinStake.mul(new BN(3)))
        );
      }
    });

    // it('staking epoch #2 started', async () => {
    //   const validators = await validatorSetHbbft.getValidators.call();

    //   const stakingEpoch = await stakingHbbft.stakingEpoch.call();
    //   stakingEpoch.should.be.bignumber.equal(new BN(2));
      
    //   const stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
    //   stakingEpochStartBlock.should.be.bignumber.equal(new BN(STAKING_EPOCH_START_BLOCK + STAKING_FIXED_EPOCH_DURATION * 2));
    //   await setCurrentBlockNumber(stakingEpochStartBlock);


    //   const pendingValidators = await validatorSetHbbft.getPendingValidators.call();
    //   pendingValidators.length.should.be.equal(0);
    //   (await validatorSetHbbft.forNewEpoch.call()).should.be.equal(false);

    //   const currentBlock = stakingEpochStartBlock.add(new BN(Math.floor(validators.length / 2) + 1));
    //   await setCurrentBlockNumber(currentBlock);

    // });

    // it('staking epoch #2 finished', async () => {
    //   const stakingEpoch = await stakingHbbft.stakingEpoch.call();
    //   stakingEpoch.should.be.bignumber.equal(new BN(2));

    //   const stakingEpochEndBlock = (await stakingHbbft.stakingEpochStartBlock.call()).add(new BN(STAKING_FIXED_EPOCH_DURATION)).sub(new BN(1));
    //   await setCurrentBlockNumber(stakingEpochEndBlock);

    //   let validators = await validatorSetHbbft.getValidators.call();
    //   const blocksCreated = stakingEpochEndBlock.sub(await validatorSetHbbft.validatorSetApplyBlock.call()).div(new BN(validators.length));
    //   blocksCreated.should.be.bignumber.above(new BN(0));
    //   for (let i = 0; i < validators.length; i++) {
    //     await blockRewardHbbft.setBlocksCreated(stakingEpoch, validators[i], blocksCreated).should.be.fulfilled;
    //   }

    //   await callReward();
    //   let pendingValidators = await validatorSetHbbft.getPendingValidators.call();
    //   pendingValidators.sortedEqual([
    //     accounts[1],
    //     accounts[2],
    //     accounts[3]
    //   ]);
    //   (await validatorSetHbbft.forNewEpoch.call()).should.be.equal(true);
    //   (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(new BN(0));
    //   await callFinalizeChange();
    //   (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(stakingEpochEndBlock);
    //   const nextStakingEpoch = stakingEpoch.add(new BN(1)); // 3
    //   (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(nextStakingEpoch);
    //   (await validatorSetHbbft.forNewEpoch.call()).should.be.equal(false);

    //   let rewardDistributed = new BN(0);
    //   for (let i = 0; i < validators.length; i++) {
    //     const epochPoolTokenReward = await blockRewardHbbft.epochPoolTokenReward.call(stakingEpoch, validators[i]);
    //     epochPoolTokenReward.should.be.bignumber.above(new BN(0));
    //     rewardDistributed = rewardDistributed.add(epochPoolTokenReward);
    //     const epochsPoolGotRewardFor = await blockRewardHbbft.epochsPoolGotRewardFor.call(validators[i]);
    //     epochsPoolGotRewardFor.length.should.be.equal(1);
    //     epochsPoolGotRewardFor[0].should.be.bignumber.equal(new BN(2));
    //   }
    //   rewardDistributed.should.be.bignumber.above(new BN(web3.utils.toWei('1.9')));
    //   rewardDistributed.should.be.bignumber.below(new BN(web3.utils.toWei('2.1')));
    //   nativeRewardUndistributed = nativeRewardUndistributed.sub(rewardDistributed);
    //   nativeRewardUndistributed.should.be.bignumber.equal(await blockRewardHbbft.nativeRewardUndistributed.call());

    //   (await erc677Token.balanceOf.call(blockRewardHbbft.address)).should.be.bignumber.equal(rewardDistributed);
    //   (await blockRewardHbbft.bridgeTokenFee.call()).should.be.bignumber.equal(new BN(0));
    //   (await blockRewardHbbft.bridgeNativeFee.call()).should.be.bignumber.equal(new BN(0));

    //   pendingValidators = await validatorSetHbbft.getPendingValidators.call();
    //   pendingValidators.length.should.be.equal(0);

    //   validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[1],
    //     accounts[2],
    //     accounts[3]
    //   ]);
    //   for (let i = 0; i < validators.length; i++) {
    //     (await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(nextStakingEpoch, validators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //     (await blockRewardHbbft.snapshotPoolTotalStakeAmount.call(nextStakingEpoch, validators[i])).should.be.bignumber.equal(
    //       candidateMinStake.add(delegatorMinStake.mul(new BN(3)))
    //     );
    //   }

    // });

    // it('staking epoch #3 started', async () => {
    //   const validators = await validatorSetHbbft.getValidators.call();

    //   const stakingEpoch = await stakingHbbft.stakingEpoch.call();
    //   stakingEpoch.should.be.bignumber.equal(new BN(3));
    //   const stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
    //   stakingEpochStartBlock.should.be.bignumber.equal(new BN(STAKING_EPOCH_START_BLOCK + STAKING_FIXED_EPOCH_DURATION * 3));
    //   await setCurrentBlockNumber(stakingEpochStartBlock);

    //   const currentBlock = stakingEpochStartBlock.add(new BN(Math.floor(validators.length / 2) + 1));
    //   await setCurrentBlockNumber(currentBlock);

    // });

    // it('three other candidates are added during the epoch #3', async () => {
    //   const candidatesMiningAddresses = accounts.slice(31, 33 + 1); // accounts[31...33]
    //   const candidatesStakingAddresses = accounts.slice(34, 36 + 1); // accounts[34...36]

    //   for (let i = 0; i < candidatesMiningAddresses.length; i++) {
    //     // Mint some balance for each candidate (imagine that each candidate got the tokens from a bridge)
    //     const miningAddress = candidatesMiningAddresses[i];
    //     const stakingAddress = candidatesStakingAddresses[i];
    //     await erc677Token.mint(stakingAddress, candidateMinStake, {from: owner}).should.be.fulfilled;
    //     candidateMinStake.should.be.bignumber.equal(await erc677Token.balanceOf.call(stakingAddress));

    //     // Candidate places stake on themselves
    //     await stakingHbbft.addPool(candidateMinStake, miningAddress,'0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    //     '0x00000000000000000000000000000000', {from: stakingAddress}).should.be.fulfilled;

    //     const delegatorsLength = 3;
    //     const delegators = accounts.slice(41 + i*delegatorsLength, 41 + i*delegatorsLength + delegatorsLength);
    //     for (let j = 0; j < delegators.length; j++) {
    //       // Mint some balance for each delegator (imagine that each delegator got the tokens from a bridge)
    //       await erc677Token.mint(delegators[j], delegatorMinStake, {from: owner}).should.be.fulfilled;
    //       delegatorMinStake.should.be.bignumber.equal(await erc677Token.balanceOf.call(delegators[j]));

    //       // Delegator places stake on the candidate
    //       await stakingHbbft.stake(stakingAddress, delegatorMinStake, {from: delegators[j]}).should.be.fulfilled;
    //     }
    // }
    // });

    // it('staking epoch #3 finished', async () => {
    //   const stakingEpoch = await stakingHbbft.stakingEpoch.call();
    //   stakingEpoch.should.be.bignumber.equal(new BN(3));

    //   const stakingEpochEndBlock = (await stakingHbbft.stakingEpochStartBlock.call()).add(new BN(STAKING_FIXED_EPOCH_DURATION)).sub(new BN(1));
    //   await setCurrentBlockNumber(stakingEpochEndBlock);

    //   let validators = await validatorSetHbbft.getValidators.call();
    //   const blocksCreated = stakingEpochEndBlock.sub(await validatorSetHbbft.validatorSetApplyBlock.call()).div(new BN(validators.length));
    //   blocksCreated.should.be.bignumber.above(new BN(0));
    //   for (let i = 0; i < validators.length; i++) {
    //     await blockRewardHbbft.setBlocksCreated(stakingEpoch, validators[i], blocksCreated).should.be.fulfilled;
    //   }

    //   const blockRewardBalanceBeforeReward = await erc677Token.balanceOf.call(blockRewardHbbft.address);

    //   let pendingValidators = await validatorSetHbbft.getPendingValidators.call();
    //   pendingValidators.length.should.be.equal(0);
    //   await callReward();
    //   pendingValidators = await validatorSetHbbft.getPendingValidators.call();
    //   pendingValidators.sortedEqual([
    //     accounts[1],
    //     accounts[2],
    //     accounts[3],
    //     accounts[31],
    //     accounts[32],
    //     accounts[33],
    //   ]);

    //   const nextStakingEpoch = stakingEpoch.add(new BN(1)); // 4
    //   (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(new BN(0));
    //   await callFinalizeChange();
    //   (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(stakingEpochEndBlock);
    //   (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(nextStakingEpoch);
    
    //   for (let i = 0; i < pendingValidators.length; i++) {
    //     (await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(nextStakingEpoch, pendingValidators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //     (await blockRewardHbbft.snapshotPoolTotalStakeAmount.call(nextStakingEpoch, pendingValidators[i])).should.be.bignumber.equal(
    //       candidateMinStake.add(delegatorMinStake.mul(new BN(3)))
    //     );
    //   }

    //   let rewardDistributed = new BN(0);
    //   for (let i = 0; i < validators.length; i++) {
    //     const epochPoolTokenReward = await blockRewardHbbft.epochPoolTokenReward.call(stakingEpoch, validators[i]);
    //     epochPoolTokenReward.should.be.bignumber.above(new BN(0));
    //     rewardDistributed = rewardDistributed.add(epochPoolTokenReward);
    //     const epochsPoolGotRewardFor = await blockRewardHbbft.epochsPoolGotRewardFor.call(validators[i]);
    //     epochsPoolGotRewardFor.length.should.be.equal(2);
    //     epochsPoolGotRewardFor[0].should.be.bignumber.equal(new BN(2));
    //     epochsPoolGotRewardFor[1].should.be.bignumber.equal(new BN(3));
    //   }
    //   rewardDistributed.should.be.bignumber.above(new BN(0));
    //   nativeRewardUndistributed = nativeRewardUndistributed.sub(rewardDistributed);
    //   nativeRewardUndistributed.should.be.bignumber.equal(await blockRewardHbbft.nativeRewardUndistributed.call());

    //   const blockRewardBalanceAfterReward = await erc677Token.balanceOf.call(blockRewardHbbft.address);

    //   blockRewardBalanceAfterReward.should.be.bignumber.equal(blockRewardBalanceBeforeReward.add(rewardDistributed));
    //   (await blockRewardHbbft.bridgeTokenFee.call()).should.be.bignumber.equal(new BN(0));
    //   (await blockRewardHbbft.bridgeNativeFee.call()).should.be.bignumber.equal(new BN(0));
      
    //   pendingValidators = await validatorSetHbbft.getPendingValidators.call();
    //   pendingValidators.length.should.be.equal(0);

    //   validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[1],
    //     accounts[2],
    //     accounts[3],
    //     accounts[31],
    //     accounts[32],
    //     accounts[33],
    //   ]);
    //   for (let i = 0; i < validators.length; i++) {
    //     (await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(nextStakingEpoch, validators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //     (await blockRewardHbbft.snapshotPoolTotalStakeAmount.call(nextStakingEpoch, validators[i])).should.be.bignumber.equal(
    //       candidateMinStake.add(delegatorMinStake.mul(new BN(3)))
    //     );
    //   }

    // });

    // it('staking epoch #4 started', async () => {
    //   const prevValidators = await validatorSetHbbft.getValidators.call();
    //   const pendingValidators = await validatorSetHbbft.getPendingValidators.call();

    //   const stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
    //   stakingEpochStartBlock.should.be.bignumber.equal(new BN(STAKING_EPOCH_START_BLOCK + STAKING_FIXED_EPOCH_DURATION * 4));
    //   let currentBlock = stakingEpochStartBlock.add(new BN(STAKING_FIXED_EPOCH_DURATION / 2));
    //   await setCurrentBlockNumber(currentBlock);

    //   currentBlock = currentBlock.add(new BN(Math.floor(prevValidators.length / 2) + 1));
    //   await setCurrentBlockNumber(currentBlock);
    // });

    // it('three other candidates are added during the epoch #4', async () => {
    //   const candidatesMiningAddresses = accounts.slice(61, 63 + 1); // accounts[61...63]
    //   const candidatesStakingAddresses = accounts.slice(64, 66 + 1); // accounts[64...66]

    //   for (let i = 0; i < candidatesMiningAddresses.length; i++) {
    //     // Mint some balance for each candidate (imagine that each candidate got the tokens from a bridge)
    //     const miningAddress = candidatesMiningAddresses[i];
    //     const stakingAddress = candidatesStakingAddresses[i];
    //     await erc677Token.mint(stakingAddress, candidateMinStake, {from: owner}).should.be.fulfilled;
    //     candidateMinStake.should.be.bignumber.equal(await erc677Token.balanceOf.call(stakingAddress));

    //     // Candidate places stake on themselves
    //     await stakingHbbft.addPool(candidateMinStake, miningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    //     '0x00000000000000000000000000000000', {from: stakingAddress}).should.be.fulfilled;

    //     const delegatorsLength = 3;
    //     const delegators = accounts.slice(71 + i*delegatorsLength, 71 + i*delegatorsLength + delegatorsLength);
    //     for (let j = 0; j < delegators.length; j++) {
    //       // Mint some balance for each delegator (imagine that each delegator got the tokens from a bridge)
    //       await erc677Token.mint(delegators[j], delegatorMinStake, {from: owner}).should.be.fulfilled;
    //       delegatorMinStake.should.be.bignumber.equal(await erc677Token.balanceOf.call(delegators[j]));

    //       // Delegator places stake on the candidate
    //       await stakingHbbft.stake(stakingAddress, delegatorMinStake, {from: delegators[j]}).should.be.fulfilled;
    //     }
    //   }
    // });

    // it('current validators remove their pools during the epoch #4', async () => {
    //   const validators = await validatorSetHbbft.getValidators.call();
    //   for (let i = 0; i < validators.length; i++) {
    //     const stakingAddress = await validatorSetHbbft.stakingByMiningAddress.call(validators[i]);
    //     await stakingHbbft.removeMyPool({from: stakingAddress}).should.be.fulfilled;
    //   }
    // });

    // it('staking epoch #4 finished', async () => {
    //   const stakingEpoch = await stakingHbbft.stakingEpoch.call();
    //   stakingEpoch.should.be.bignumber.equal(new BN(4));

    //   const stakingEpochEndBlock = (await stakingHbbft.stakingEpochStartBlock.call()).add(new BN(STAKING_FIXED_EPOCH_DURATION)).sub(new BN(1));
    //   await setCurrentBlockNumber(stakingEpochEndBlock);

    //   let validators = await validatorSetHbbft.getValidators.call();
    //   const blocksCreated = stakingEpochEndBlock.sub(await validatorSetHbbft.validatorSetApplyBlock.call()).div(new BN(validators.length));
    //   blocksCreated.should.be.bignumber.above(new BN(0));
    //   for (let i = 0; i < validators.length; i++) {
    //     await blockRewardHbbft.setBlocksCreated(stakingEpoch, validators[i], blocksCreated).should.be.fulfilled;
    //   }

    //   const blockRewardBalanceBeforeReward = await erc677Token.balanceOf.call(blockRewardHbbft.address);

    //   await callReward();
    //   const nextStakingEpoch = stakingEpoch.add(new BN(1)); // 4
      
    //   let pendingValidators = await validatorSetHbbft.getPendingValidators.call();
    //   pendingValidators.sortedEqual([
    //     accounts[61],
    //     accounts[62],
    //     accounts[63],
    //   ]);
    //   for (let i = 0; i < pendingValidators.length; i++) {
    //     (await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(nextStakingEpoch, pendingValidators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //     (await blockRewardHbbft.snapshotPoolTotalStakeAmount.call(nextStakingEpoch, pendingValidators[i])).should.be.bignumber.equal(
    //       candidateMinStake.add(delegatorMinStake.mul(new BN(3)))
    //     );
    //   }

    //   (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(new BN(0));
    //   await callFinalizeChange();
    //   (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(stakingEpochEndBlock);
    //   (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(nextStakingEpoch);
      
    //   (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(nextStakingEpoch);

    //   let rewardDistributed = new BN(0);
    //   for (let i = 0; i < validators.length; i++) {
    //     const epochPoolTokenReward = await blockRewardHbbft.epochPoolTokenReward.call(stakingEpoch, validators[i]);
    //     epochPoolTokenReward.should.be.bignumber.above(new BN(0));
    //     rewardDistributed = rewardDistributed.add(epochPoolTokenReward);
    //     const epochsPoolGotRewardFor = await blockRewardHbbft.epochsPoolGotRewardFor.call(validators[i]);
    //     if (i == 0) {
    //       epochsPoolGotRewardFor.length.should.be.equal(3);
    //       epochsPoolGotRewardFor[0].should.be.bignumber.equal(new BN(2));
    //       epochsPoolGotRewardFor[1].should.be.bignumber.equal(new BN(3));
    //       epochsPoolGotRewardFor[2].should.be.bignumber.equal(new BN(4));
    //     }
    //   }
    //   rewardDistributed.should.be.bignumber.above(web3.utils.toWei(new BN(1)).div(new BN(2)));
    //   // rewardDistributed.should.be.bignumber.below(web3.utils.toWei(new BN(1)));
    //   nativeRewardUndistributed = nativeRewardUndistributed.sub(rewardDistributed);
    //   nativeRewardUndistributed.should.be.bignumber.equal(await blockRewardHbbft.nativeRewardUndistributed.call());

    //   const blockRewardBalanceAfterReward = await erc677Token.balanceOf.call(blockRewardHbbft.address);

    //   blockRewardBalanceAfterReward.should.be.bignumber.equal(blockRewardBalanceBeforeReward.add(rewardDistributed));
    //   (await blockRewardHbbft.bridgeTokenFee.call()).should.be.bignumber.equal(new BN(0));
    //   (await blockRewardHbbft.bridgeNativeFee.call()).should.be.bignumber.equal(new BN(0));

    //   pendingValidators = await validatorSetHbbft.getPendingValidators.call();
    //   pendingValidators.length.should.be.equal(0);

    //   validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[61],
    //     accounts[62],
    //     accounts[63],
    //   ]);
    //   for (let i = 0; i < validators.length; i++) {
    //     (await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(nextStakingEpoch, validators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //     (await blockRewardHbbft.snapshotPoolTotalStakeAmount.call(nextStakingEpoch, validators[i])).should.be.bignumber.equal(
    //       candidateMinStake.add(delegatorMinStake.mul(new BN(3)))
    //     );
    //   }

    // });

    // it('staking epoch #5 started', async () => {
    //   const stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
    //   stakingEpochStartBlock.should.be.bignumber.equal(new BN(STAKING_EPOCH_START_BLOCK + STAKING_FIXED_EPOCH_DURATION * 5));
    //   await setCurrentBlockNumber(stakingEpochStartBlock);

    // });

    // it('current pending validators remove their pools during the epoch #5', async () => {
    //   const pendingValidators = await validatorSetHbbft.getPendingValidators.call();
    //   for (let i = 0; i < pendingValidators.length; i++) {
    //     const stakingAddress = await validatorSetHbbft.stakingByMiningAddress.call(pendingValidators[i]);
    //     await stakingHbbft.removeMyPool({from: stakingAddress}).should.be.fulfilled;
    //   }
    // });

    // it('three other candidates are added during the epoch #5', async () => {
    //   const candidatesMiningAddresses = accounts.slice(91, 93 + 1); // accounts[91...93]
    //   const candidatesStakingAddresses = accounts.slice(94, 96 + 1); // accounts[94...96]

    //   for (let i = 0; i < candidatesMiningAddresses.length; i++) {
    //     // Mint some balance for each candidate (imagine that each candidate got the tokens from a bridge)
    //     const miningAddress = candidatesMiningAddresses[i];
    //     const stakingAddress = candidatesStakingAddresses[i];
    //     await erc677Token.mint(stakingAddress, candidateMinStake, {from: owner}).should.be.fulfilled;
    //     candidateMinStake.should.be.bignumber.equal(await erc677Token.balanceOf.call(stakingAddress));

    //     // Candidate places stake on themselves
    //     await stakingHbbft.addPool(candidateMinStake, miningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    //     '0x00000000000000000000000000000000', {from: stakingAddress}).should.be.fulfilled;
    //   }
    // });

    // it('staking epoch #5 finished', async () => {
    //   const stakingEpoch = await stakingHbbft.stakingEpoch.call();
    //   stakingEpoch.should.be.bignumber.equal(new BN(5));

    //   const stakingEpochEndBlock = (await stakingHbbft.stakingEpochStartBlock.call()).add(new BN(STAKING_FIXED_EPOCH_DURATION)).sub(new BN(1));
    //   await setCurrentBlockNumber(stakingEpochEndBlock);

    //   let validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[1],
    //     accounts[2],
    //     accounts[3],
    //     accounts[31],
    //     accounts[32],
    //     accounts[33]
    //   ]);

    //   const blockRewardBalanceBeforeReward = await erc677Token.balanceOf.call(blockRewardHbbft.address);

    //   (await validatorSetHbbft.emitInitiateChangeCallable.call()).should.be.equal(false);
    //   (await validatorSetHbbft.isValidatorBanned.call(accounts[32])).should.be.equal(false);
    //   (await validatorSetHbbft.isValidatorBanned.call(accounts[33])).should.be.equal(false);
    //   await callReward();
    //   const nextStakingEpoch = stakingEpoch.add(new BN(1)); // 6
    //   (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(nextStakingEpoch);
    //   (await validatorSetHbbft.emitInitiateChangeCallable.call()).should.be.equal(false);
    //   // (await validatorSetHbbft.isValidatorBanned.call(accounts[32])).should.be.equal(true);
    //   // (await validatorSetHbbft.isValidatorBanned.call(accounts[33])).should.be.equal(true);

    //   for (let i = 0; i < validators.length; i++) {
    //     const epochPoolTokenReward = await blockRewardHbbft.epochPoolTokenReward.call(stakingEpoch, validators[i]);
    //     epochPoolTokenReward.should.be.bignumber.equal(new BN(0));
    //   }

    //   const blockRewardBalanceAfterReward = await erc677Token.balanceOf.call(blockRewardHbbft.address);

    //   blockRewardBalanceAfterReward.should.be.bignumber.equal(blockRewardBalanceBeforeReward);
    //   (await blockRewardHbbft.bridgeTokenFee.call()).should.be.bignumber.equal(new BN(0));
    //   (await blockRewardHbbft.bridgeNativeFee.call()).should.be.bignumber.equal(new BN(0));

    //   const pendingValidators = await validatorSetHbbft.getPendingValidators.call();
    //   pendingValidators.sortedEqual([
    //     accounts[91],
    //     accounts[92],
    //     accounts[93],
    //   ]);
    //   for (let i = 0; i < pendingValidators.length; i++) {
    //     (await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(nextStakingEpoch, pendingValidators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //     (await blockRewardHbbft.snapshotPoolTotalStakeAmount.call(nextStakingEpoch, pendingValidators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //   }

    //   validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[1],
    //     accounts[2],
    //     accounts[3],
    //     accounts[31],
    //     accounts[32],
    //     accounts[33],
    //   ]);
    //   for (let i = 0; i < validators.length; i++) {
    //     (await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(nextStakingEpoch, validators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //     (await blockRewardHbbft.snapshotPoolTotalStakeAmount.call(nextStakingEpoch, validators[i])).should.be.bignumber.equal(
    //       candidateMinStake.add(delegatorMinStake.mul(new BN(3)))
    //     );
    //   }

    //   const validatorsToBeFinalized = (await validatorSetHbbft.validatorsToBeFinalized.call()).miningAddresses;
    //   validatorsToBeFinalized.sortedEqual([
    //     accounts[61],
    //     accounts[62],
    //     accounts[63]
    //   ]);
    //   for (let i = 0; i < validatorsToBeFinalized.length; i++) {
    //     (await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(nextStakingEpoch, validatorsToBeFinalized[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //     (await blockRewardHbbft.snapshotPoolTotalStakeAmount.call(nextStakingEpoch, validatorsToBeFinalized[i])).should.be.bignumber.equal(
    //       candidateMinStake.add(delegatorMinStake.mul(new BN(3)))
    //     );
    //   }
    // });

    // it('staking epoch #6 started', async () => {
    //   const stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
    //   stakingEpochStartBlock.should.be.bignumber.equal(new BN(STAKING_EPOCH_START_BLOCK + STAKING_FIXED_EPOCH_DURATION * 6));
    //   let currentBlock = stakingEpochStartBlock.add(new BN(STAKING_FIXED_EPOCH_DURATION / 2));
    //   await setCurrentBlockNumber(currentBlock);

    //   (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(new BN(0));
    //   await callFinalizeChange();
    //   (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(currentBlock);
    //   const validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[61],
    //     accounts[62],
    //     accounts[63]
    //   ]);

    //   const {logs} = await validatorSetHbbft.emitInitiateChange().should.be.fulfilled;
    //   logs[0].event.should.be.equal("InitiateChange");
    //   logs[0].args.newSet.should.be.deep.equal([
    //     accounts[91],
    //     accounts[92],
    //     accounts[93]
    //   ]);
    // });

    // it('  all upcoming validators remove their pools during the epoch #6', async () => {
    //   const validatorsToBeFinalized = (await validatorSetHbbft.validatorsToBeFinalized.call()).miningAddresses;
    //   for (let i = 0; i < validatorsToBeFinalized.length; i++) {
    //     const stakingAddress = await validatorSetHbbft.stakingByMiningAddress.call(validatorsToBeFinalized[i]);
    //     await stakingHbbft.removeMyPool({from: stakingAddress}).should.be.fulfilled;
    //   }
    // });

    // it('three other candidates are added during the epoch #6', async () => {
    //   const candidatesMiningAddresses = accounts.slice(101, 103 + 1); // accounts[101...103]
    //   const candidatesStakingAddresses = accounts.slice(104, 106 + 1); // accounts[104...106]

    //   for (let i = 0; i < candidatesMiningAddresses.length; i++) {
    //     // Mint some balance for each candidate (imagine that each candidate got the tokens from a bridge)
    //     const miningAddress = candidatesMiningAddresses[i];
    //     const stakingAddress = candidatesStakingAddresses[i];
    //     await erc677Token.mint(stakingAddress, candidateMinStake, {from: owner}).should.be.fulfilled;
    //     candidateMinStake.should.be.bignumber.equal(await erc677Token.balanceOf.call(stakingAddress));

    //     // Candidate places stake on themselves
    //     await stakingHbbft.addPool(candidateMinStake, miningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    //     '0x00000000000000000000000000000000', {from: stakingAddress}).should.be.fulfilled;
    //   }
    // });

    // it('staking epoch #6 finished', async () => {
    //   const stakingEpoch = await stakingHbbft.stakingEpoch.call();
    //   stakingEpoch.should.be.bignumber.equal(new BN(6));

    //   const stakingEpochEndBlock = (await stakingHbbft.stakingEpochStartBlock.call()).add(new BN(STAKING_FIXED_EPOCH_DURATION)).sub(new BN(1));
    //   await setCurrentBlockNumber(stakingEpochEndBlock);

    //   let validators = await validatorSetHbbft.getValidators.call();
    //   const blocksCreated = stakingEpochEndBlock.sub(await validatorSetHbbft.validatorSetApplyBlock.call()).div(new BN(validators.length));
    //   blocksCreated.should.be.bignumber.above(new BN(0));
    //   validators.sortedEqual([
    //     accounts[61],
    //     accounts[62],
    //     accounts[63]
    //   ]);
    //   for (let i = 0; i < validators.length; i++) {
    //     await blockRewardHbbft.setBlocksCreated(stakingEpoch, validators[i], blocksCreated).should.be.fulfilled;
    //   }

    //   const blockRewardBalanceBeforeReward = await erc677Token.balanceOf.call(blockRewardHbbft.address);

    //   (await validatorSetHbbft.emitInitiateChangeCallable.call()).should.be.equal(false);
    //   (await validatorSetHbbft.isValidatorBanned.call(accounts[62])).should.be.equal(false);
    //   (await validatorSetHbbft.isValidatorBanned.call(accounts[63])).should.be.equal(false);
    //   await callReward();
    //   const nextStakingEpoch = stakingEpoch.add(new BN(1)); // 7
    //   (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(nextStakingEpoch);
    //   (await validatorSetHbbft.emitInitiateChangeCallable.call()).should.be.equal(false);
    //   // (await validatorSetHbbft.isValidatorBanned.call(accounts[62])).should.be.equal(true);
    //   // (await validatorSetHbbft.isValidatorBanned.call(accounts[63])).should.be.equal(true);

    //   let rewardDistributed = new BN(0);
    //   for (let i = 0; i < validators.length; i++) {
    //     const epochPoolTokenReward = await blockRewardHbbft.epochPoolTokenReward.call(stakingEpoch, validators[i]);
    //     // if (validators[i] == accounts[61]) {
    //       epochPoolTokenReward.should.be.bignumber.above(new BN(0));
    //     // } else {
    //       // epochPoolTokenReward.should.be.bignumber.equal(new BN(0));
    //     // }
    //     rewardDistributed = rewardDistributed.add(epochPoolTokenReward);
    //   }
    //   Math.round(Number(web3.utils.fromWei(rewardDistributed)) * 100).should.be.equal(
    //     Math.round(Number(web3.utils.fromWei(nativeRewardUndistributed.div(new BN(2)))) * 100)
    //   );
    //   nativeRewardUndistributed = nativeRewardUndistributed.sub(rewardDistributed);
    //   nativeRewardUndistributed.should.be.bignumber.equal(await blockRewardHbbft.nativeRewardUndistributed.call());

    //   const blockRewardBalanceAfterReward = await erc677Token.balanceOf.call(blockRewardHbbft.address);

    //   blockRewardBalanceAfterReward.should.be.bignumber.equal(blockRewardBalanceBeforeReward.add(rewardDistributed));
    //   (await blockRewardHbbft.bridgeTokenFee.call()).should.be.bignumber.equal(new BN(0));
    //   (await blockRewardHbbft.bridgeNativeFee.call()).should.be.bignumber.equal(new BN(0));

    //   const pendingValidators = await validatorSetHbbft.getPendingValidators.call();
    //   pendingValidators.sortedEqual([
    //     accounts[101],
    //     accounts[102],
    //     accounts[103],
    //   ]);
    //   for (let i = 0; i < pendingValidators.length; i++) {
    //     (await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(nextStakingEpoch, pendingValidators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //     (await blockRewardHbbft.snapshotPoolTotalStakeAmount.call(nextStakingEpoch, pendingValidators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //   }

    //   validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[61],
    //     accounts[62],
    //     accounts[63],
    //   ]);
    //   for (let i = 0; i < validators.length; i++) {
    //     (await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(nextStakingEpoch, validators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //     (await blockRewardHbbft.snapshotPoolTotalStakeAmount.call(nextStakingEpoch, validators[i])).should.be.bignumber.equal(
    //       candidateMinStake.add(delegatorMinStake.mul(new BN(3)))
    //     );
    //   }

    //   const validatorsToBeFinalized = (await validatorSetHbbft.validatorsToBeFinalized.call()).miningAddresses;
    //   validatorsToBeFinalized.sortedEqual([
    //     accounts[91],
    //     accounts[92],
    //     accounts[93]
    //   ]);
    //   for (let i = 0; i < validatorsToBeFinalized.length; i++) {
    //     (await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(nextStakingEpoch, validatorsToBeFinalized[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //     (await blockRewardHbbft.snapshotPoolTotalStakeAmount.call(nextStakingEpoch, validatorsToBeFinalized[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //   }
    // });

    // it('staking epoch #7 started', async () => {
    //   const stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
    //   stakingEpochStartBlock.should.be.bignumber.equal(new BN(STAKING_EPOCH_START_BLOCK + STAKING_FIXED_EPOCH_DURATION * 7));
    //   await setCurrentBlockNumber(stakingEpochStartBlock);

    //   (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(new BN(0));
    //   const validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[61],
    //     accounts[62],
    //     accounts[63]
    //   ]);

    //   await validatorSetHbbft.emitInitiateChange().should.be.rejectedWith(ERROR_MSG);
    // });

    // it('  all pending validators remove their pools during the epoch #7', async () => {
    //   const pendingValidators = await validatorSetHbbft.getPendingValidators.call();
    //   pendingValidators.sortedEqual([
    //     accounts[101],
    //     accounts[102],
    //     accounts[103],
    //   ]);
    //   for (let i = 0; i < pendingValidators.length; i++) {
    //     const stakingAddress = await validatorSetHbbft.stakingByMiningAddress.call(pendingValidators[i]);
    //     await stakingHbbft.removeMyPool({from: stakingAddress}).should.be.fulfilled;
    //   }
    // });

    // it('  three other candidates are added during the epoch #7', async () => {
    //   const candidatesMiningAddresses = accounts.slice(111, 113 + 1); // accounts[111...113]
    //   const candidatesStakingAddresses = accounts.slice(114, 116 + 1); // accounts[114...116]

    //   for (let i = 0; i < candidatesMiningAddresses.length; i++) {
    //     // Mint some balance for each candidate (imagine that each candidate got the tokens from a bridge)
    //     const miningAddress = candidatesMiningAddresses[i];
    //     const stakingAddress = candidatesStakingAddresses[i];
    //     await erc677Token.mint(stakingAddress, candidateMinStake, {from: owner}).should.be.fulfilled;
    //     candidateMinStake.should.be.bignumber.equal(await erc677Token.balanceOf.call(stakingAddress));

    //     // Candidate places stake on themselves
    //     await stakingHbbft.addPool(candidateMinStake, miningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    //     '0x00000000000000000000000000000000', {from: stakingAddress}).should.be.fulfilled;
    //   }
    // });

    // it('staking epoch #7 finished', async () => {
    //   const stakingEpoch = await stakingHbbft.stakingEpoch.call();
    //   stakingEpoch.should.be.bignumber.equal(new BN(7));

    //   const stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
    //   const stakingEpochEndBlock = stakingEpochStartBlock.add(new BN(STAKING_FIXED_EPOCH_DURATION)).sub(new BN(1));
    //   await setCurrentBlockNumber(stakingEpochEndBlock);

    //   let validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[61],
    //     accounts[62],
    //     accounts[63]
    //   ]);
    //   for (let i = 0; i < validators.length; i++) {
    //     await blockRewardHbbft.setBlocksCreated(stakingEpoch, validators[i], new BN(0)).should.be.fulfilled;
    //   }

    //   const blockRewardBalanceBeforeReward = await erc677Token.balanceOf.call(blockRewardHbbft.address);

    //   const bannedUntil62 = await validatorSetHbbft.bannedUntil.call(accounts[62]);
    //   const bannedUntil63 = await validatorSetHbbft.bannedUntil.call(accounts[63]);
    //   const bannedDelegatorsUntil62 = await validatorSetHbbft.bannedDelegatorsUntil.call(accounts[62]);
    //   const bannedDelegatorsUntil63 = await validatorSetHbbft.bannedDelegatorsUntil.call(accounts[63]);

    //   (await validatorSetHbbft.emitInitiateChangeCallable.call()).should.be.equal(false);
    //   // (await validatorSetHbbft.isValidatorBanned.call(accounts[62])).should.be.equal(true);
    //   // (await validatorSetHbbft.isValidatorBanned.call(accounts[63])).should.be.equal(true);
    //   await callReward();
    //   const nextStakingEpoch = stakingEpoch.add(new BN(1)); // 8
    //   (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(nextStakingEpoch);
    //   (await validatorSetHbbft.emitInitiateChangeCallable.call()).should.be.equal(false);
    //   // (await validatorSetHbbft.isValidatorBanned.call(accounts[62])).should.be.equal(true);
    //   // (await validatorSetHbbft.isValidatorBanned.call(accounts[63])).should.be.equal(true);
    //   // (await validatorSetHbbft.bannedUntil.call(accounts[62])).should.be.bignumber.equal(bannedUntil62.add(new BN(STAKING_FIXED_EPOCH_DURATION)));
    //   // (await validatorSetHbbft.bannedUntil.call(accounts[63])).should.be.bignumber.equal(bannedUntil63.add(new BN(STAKING_FIXED_EPOCH_DURATION)));
    //   // (await validatorSetHbbft.bannedDelegatorsUntil.call(accounts[62])).should.be.bignumber.equal(bannedDelegatorsUntil62);
    //   // (await validatorSetHbbft.bannedDelegatorsUntil.call(accounts[63])).should.be.bignumber.equal(bannedDelegatorsUntil63);

    //   for (let i = 0; i < validators.length; i++) {
    //     const epochPoolTokenReward = await blockRewardHbbft.epochPoolTokenReward.call(stakingEpoch, validators[i]);
    //     epochPoolTokenReward.should.be.bignumber.equal(new BN(0));
    //   }
    //   nativeRewardUndistributed.should.be.bignumber.equal(await blockRewardHbbft.nativeRewardUndistributed.call());

    //   const blockRewardBalanceAfterReward = await erc677Token.balanceOf.call(blockRewardHbbft.address);

    //   blockRewardBalanceAfterReward.should.be.bignumber.equal(blockRewardBalanceBeforeReward);
    //   (await blockRewardHbbft.bridgeTokenFee.call()).should.be.bignumber.equal(new BN(0));
    //   (await blockRewardHbbft.bridgeNativeFee.call()).should.be.bignumber.equal(new BN(0));

    //   const pendingValidators = await validatorSetHbbft.getPendingValidators.call();
    //   pendingValidators.sortedEqual([
    //     accounts[111],
    //     accounts[112],
    //     accounts[113],
    //   ]);
    //   for (let i = 0; i < pendingValidators.length; i++) {
    //     (await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(nextStakingEpoch, pendingValidators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //     (await blockRewardHbbft.snapshotPoolTotalStakeAmount.call(nextStakingEpoch, pendingValidators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //   }

    //   validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[61],
    //     accounts[62],
    //     accounts[63],
    //   ]);
    //   for (let i = 0; i < validators.length; i++) {
    //     (await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(nextStakingEpoch, validators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //     (await blockRewardHbbft.snapshotPoolTotalStakeAmount.call(nextStakingEpoch, validators[i])).should.be.bignumber.equal(
    //       candidateMinStake.add(delegatorMinStake.mul(new BN(3)))
    //     );
    //   }

    //   const validatorsToBeFinalized = (await validatorSetHbbft.validatorsToBeFinalized.call()).miningAddresses;
    //   validatorsToBeFinalized.sortedEqual([
    //     accounts[91],
    //     accounts[92],
    //     accounts[93]
    //   ]);
    //   for (let i = 0; i < validatorsToBeFinalized.length; i++) {
    //     (await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(nextStakingEpoch, validatorsToBeFinalized[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //     (await blockRewardHbbft.snapshotPoolTotalStakeAmount.call(nextStakingEpoch, validatorsToBeFinalized[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //   }
    // });

    // it('staking epoch #8 started', async () => {
    //   const stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
    //   stakingEpochStartBlock.should.be.bignumber.equal(new BN(STAKING_EPOCH_START_BLOCK + STAKING_FIXED_EPOCH_DURATION * 8));
    //   await setCurrentBlockNumber(stakingEpochStartBlock);

    //   (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(new BN(0));
    //   const validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[61],
    //     accounts[62],
    //     accounts[63]
    //   ]);

    //   await validatorSetHbbft.emitInitiateChange().should.be.rejectedWith(ERROR_MSG);
    // });

    // it('  all pending validators remove their pools during the epoch #8', async () => {
    //   const pendingValidators = await validatorSetHbbft.getPendingValidators.call();
    //   pendingValidators.sortedEqual([
    //     accounts[111],
    //     accounts[112],
    //     accounts[113],
    //   ]);
    //   for (let i = 0; i < pendingValidators.length; i++) {
    //     const stakingAddress = await validatorSetHbbft.stakingByMiningAddress.call(pendingValidators[i]);
    //     await stakingHbbft.removeMyPool({from: stakingAddress}).should.be.fulfilled;
    //   }
    // });

    // it('  three other candidates are added during the epoch #8', async () => {
    //   const candidatesMiningAddresses = accounts.slice(121, 123 + 1); // accounts[121...123]
    //   const candidatesStakingAddresses = accounts.slice(124, 126 + 1); // accounts[124...126]

    //   for (let i = 0; i < candidatesMiningAddresses.length; i++) {
    //     // Mint some balance for each candidate (imagine that each candidate got the tokens from a bridge)
    //     const miningAddress = candidatesMiningAddresses[i];
    //     const stakingAddress = candidatesStakingAddresses[i];
    //     await erc677Token.mint(stakingAddress, candidateMinStake, {from: owner}).should.be.fulfilled;
    //     candidateMinStake.should.be.bignumber.equal(await erc677Token.balanceOf.call(stakingAddress));

    //     // Candidate places stake on themselves
    //     await stakingHbbft.addPool(candidateMinStake, miningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    //     '0x00000000000000000000000000000000', {from: stakingAddress}).should.be.fulfilled;
    //   }
    // });

    // it('staking epoch #8 finished', async () => {
    //   const stakingEpoch = await stakingHbbft.stakingEpoch.call();
    //   stakingEpoch.should.be.bignumber.equal(new BN(8));

    //   const stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
    //   const stakingEpochEndBlock = stakingEpochStartBlock.add(new BN(STAKING_FIXED_EPOCH_DURATION)).sub(new BN(1));
    //   await setCurrentBlockNumber(stakingEpochEndBlock);

    //   let validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[61],
    //     accounts[62],
    //     accounts[63]
    //   ]);
    //   for (let i = 0; i < validators.length; i++) {
    //     await blockRewardHbbft.setBlocksCreated(stakingEpoch, validators[i], new BN(0)).should.be.fulfilled;
    //   }

    //   const blockRewardBalanceBeforeReward = await erc677Token.balanceOf.call(blockRewardHbbft.address);

    //   // const bannedUntil62 = await validatorSetHbbft.bannedUntil.call(accounts[62]);
    //   // const bannedUntil63 = await validatorSetHbbft.bannedUntil.call(accounts[63]);
    //   // const bannedDelegatorsUntil62 = await validatorSetHbbft.bannedDelegatorsUntil.call(accounts[62]);
    //   // const bannedDelegatorsUntil63 = await validatorSetHbbft.bannedDelegatorsUntil.call(accounts[63]);

    //   (await validatorSetHbbft.emitInitiateChangeCallable.call()).should.be.equal(false);
    //   // (await validatorSetHbbft.isValidatorBanned.call(accounts[62])).should.be.equal(true);
    //   // (await validatorSetHbbft.isValidatorBanned.call(accounts[63])).should.be.equal(true);
    //   await callReward();
    //   const nextStakingEpoch = stakingEpoch.add(new BN(1)); // 9
    //   (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(nextStakingEpoch);
    //   (await validatorSetHbbft.emitInitiateChangeCallable.call()).should.be.equal(false);
    //   // (await validatorSetHbbft.isValidatorBanned.call(accounts[62])).should.be.equal(true);
    //   // (await validatorSetHbbft.isValidatorBanned.call(accounts[63])).should.be.equal(true);
    //   // (await validatorSetHbbft.bannedUntil.call(accounts[62])).should.be.bignumber.equal(bannedUntil62.add(new BN(STAKING_FIXED_EPOCH_DURATION)));
    //   // (await validatorSetHbbft.bannedUntil.call(accounts[63])).should.be.bignumber.equal(bannedUntil63.add(new BN(STAKING_FIXED_EPOCH_DURATION)));
    //   // (await validatorSetHbbft.bannedDelegatorsUntil.call(accounts[62])).should.be.bignumber.equal(bannedDelegatorsUntil62);
    //   // (await validatorSetHbbft.bannedDelegatorsUntil.call(accounts[63])).should.be.bignumber.equal(bannedDelegatorsUntil63);

    //   for (let i = 0; i < validators.length; i++) {
    //     const epochPoolTokenReward = await blockRewardHbbft.epochPoolTokenReward.call(stakingEpoch, validators[i]);
    //     epochPoolTokenReward.should.be.bignumber.equal(new BN(0));
    //   }
    //   nativeRewardUndistributed.should.be.bignumber.equal(await blockRewardHbbft.nativeRewardUndistributed.call());

    //   const blockRewardBalanceAfterReward = await erc677Token.balanceOf.call(blockRewardHbbft.address);

    //   blockRewardBalanceAfterReward.should.be.bignumber.equal(blockRewardBalanceBeforeReward);
    //   (await blockRewardHbbft.bridgeTokenFee.call()).should.be.bignumber.equal(new BN(0));
    //   (await blockRewardHbbft.bridgeNativeFee.call()).should.be.bignumber.equal(new BN(0));

    //   const pendingValidators = await validatorSetHbbft.getPendingValidators.call();
    //   pendingValidators.sortedEqual([
    //     accounts[121],
    //     accounts[122],
    //     accounts[123],
    //   ]);
    //   for (let i = 0; i < pendingValidators.length; i++) {
    //     (await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(nextStakingEpoch, pendingValidators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //     (await blockRewardHbbft.snapshotPoolTotalStakeAmount.call(nextStakingEpoch, pendingValidators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //   }

    //   validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[61],
    //     accounts[62],
    //     accounts[63],
    //   ]);
    //   for (let i = 0; i < validators.length; i++) {
    //     (await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(nextStakingEpoch, validators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //     (await blockRewardHbbft.snapshotPoolTotalStakeAmount.call(nextStakingEpoch, validators[i])).should.be.bignumber.equal(
    //       candidateMinStake.add(delegatorMinStake.mul(new BN(3)))
    //     );
    //   }

    //   const validatorsToBeFinalized = (await validatorSetHbbft.validatorsToBeFinalized.call()).miningAddresses;
    //   validatorsToBeFinalized.sortedEqual([
    //     accounts[91],
    //     accounts[92],
    //     accounts[93]
    //   ]);
    //   for (let i = 0; i < validatorsToBeFinalized.length; i++) {
    //     (await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(nextStakingEpoch, validatorsToBeFinalized[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //     (await blockRewardHbbft.snapshotPoolTotalStakeAmount.call(nextStakingEpoch, validatorsToBeFinalized[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //   }
    // });

    // it('staking epoch #9 started', async () => {
    //   const stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
    //   stakingEpochStartBlock.should.be.bignumber.equal(new BN(STAKING_EPOCH_START_BLOCK + STAKING_FIXED_EPOCH_DURATION * 9));
    //   let currentBlock = stakingEpochStartBlock.add(new BN(STAKING_FIXED_EPOCH_DURATION / 4));
    //   await setCurrentBlockNumber(currentBlock);

    //   (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(new BN(0));
    //   await callFinalizeChange();
    //   (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(currentBlock);
    //   let validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[91],
    //     accounts[92],
    //     accounts[93]
    //   ]);

    //   currentBlock = stakingEpochStartBlock.add(new BN(STAKING_FIXED_EPOCH_DURATION / 2));
    //   await setCurrentBlockNumber(currentBlock);

    //   const {logs} = await validatorSetHbbft.emitInitiateChange().should.be.fulfilled;
    //   logs[0].event.should.be.equal("InitiateChange");
    //   logs[0].args.newSet.should.be.deep.equal([
    //     accounts[121],
    //     accounts[122],
    //     accounts[123]
    //   ]);

    //   await callFinalizeChange();

    //   (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(currentBlock);
    //   validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[121],
    //     accounts[122],
    //     accounts[123]
    //   ]);
    // });

    // it('  all current validators remove their pools during the epoch #9', async () => {
    //   const validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[121],
    //     accounts[122],
    //     accounts[123],
    //   ]);
    //   for (let i = 0; i < validators.length; i++) {
    //     const stakingAddress = await validatorSetHbbft.stakingByMiningAddress.call(validators[i]);
    //     await stakingHbbft.removeMyPool({from: stakingAddress}).should.be.fulfilled;
    //   }
    // });

    // it('  three other candidates are added during the epoch #9', async () => {
    //   const candidatesMiningAddresses = accounts.slice(131, 133 + 1); // accounts[131...133]
    //   const candidatesStakingAddresses = accounts.slice(134, 136 + 1); // accounts[134...136]

    //   for (let i = 0; i < candidatesMiningAddresses.length; i++) {
    //     // Mint some balance for each candidate (imagine that each candidate got the tokens from a bridge)
    //     const miningAddress = candidatesMiningAddresses[i];
    //     const stakingAddress = candidatesStakingAddresses[i];
    //     await erc677Token.mint(stakingAddress, candidateMinStake, {from: owner}).should.be.fulfilled;
    //     candidateMinStake.should.be.bignumber.equal(await erc677Token.balanceOf.call(stakingAddress));

    //     // Candidate places stake on themselves
    //     await stakingHbbft.addPool(candidateMinStake, miningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    //     '0x00000000000000000000000000000000', {from: stakingAddress}).should.be.fulfilled;
    //   }
    // });

    // it('staking epoch #9 finished', async () => {
    //   const stakingEpoch = await stakingHbbft.stakingEpoch.call();
    //   stakingEpoch.should.be.bignumber.equal(new BN(9));

    //   const stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
    //   const stakingEpochEndBlock = stakingEpochStartBlock.add(new BN(STAKING_FIXED_EPOCH_DURATION)).sub(new BN(1));
    //   await setCurrentBlockNumber(stakingEpochEndBlock);

    //   let validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[121],
    //     accounts[122],
    //     accounts[123]
    //   ]);
    //   const blocksCreated = stakingEpochEndBlock.sub(await validatorSetHbbft.validatorSetApplyBlock.call()).div(new BN(validators.length));
    //   blocksCreated.should.be.bignumber.above(new BN(0));
    //   for (let i = 0; i < validators.length; i++) {
    //     await blockRewardHbbft.setBlocksCreated(stakingEpoch, validators[i], blocksCreated).should.be.fulfilled;
    //   }

    //   const blockRewardBalanceBeforeReward = await erc677Token.balanceOf.call(blockRewardHbbft.address);

    //   (await validatorSetHbbft.emitInitiateChangeCallable.call()).should.be.equal(false);
    //   await callReward();
    //   const nextStakingEpoch = stakingEpoch.add(new BN(1)); // 10
    //   (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(nextStakingEpoch);
    //   (await validatorSetHbbft.emitInitiateChangeCallable.call()).should.be.equal(true);

    //   let rewardDistributed = new BN(0);
    //   for (let i = 0; i < validators.length; i++) {
    //     const epochPoolTokenReward = await blockRewardHbbft.epochPoolTokenReward.call(stakingEpoch, validators[i]);
    //     epochPoolTokenReward.should.be.bignumber.above(new BN(0));
    //     rewardDistributed = rewardDistributed.add(epochPoolTokenReward);
    //   }
    //   rewardDistributed.toString().substring(0, 3).should.be.equal(nativeRewardUndistributed.div(new BN(2)).toString().substring(0, 3));
    //   nativeRewardUndistributed = nativeRewardUndistributed.sub(rewardDistributed);
    //   nativeRewardUndistributed.should.be.bignumber.equal(await blockRewardHbbft.nativeRewardUndistributed.call());

    //   const blockRewardBalanceAfterReward = await erc677Token.balanceOf.call(blockRewardHbbft.address);

    //   blockRewardBalanceAfterReward.should.be.bignumber.equal(blockRewardBalanceBeforeReward.add(rewardDistributed));
    //   (await blockRewardHbbft.bridgeTokenFee.call()).should.be.bignumber.equal(new BN(0));
    //   (await blockRewardHbbft.bridgeNativeFee.call()).should.be.bignumber.equal(new BN(0));

    //   const pendingValidators = await validatorSetHbbft.getPendingValidators.call();
    //   pendingValidators.sortedEqual([
    //     accounts[131],
    //     accounts[132],
    //     accounts[133],
    //   ]);
    //   for (let i = 0; i < pendingValidators.length; i++) {
    //     (await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(nextStakingEpoch, pendingValidators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //     (await blockRewardHbbft.snapshotPoolTotalStakeAmount.call(nextStakingEpoch, pendingValidators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //   }

    //   validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[121],
    //     accounts[122],
    //     accounts[123],
    //   ]);
    //   for (let i = 0; i < validators.length; i++) {
    //     (await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(nextStakingEpoch, validators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //     (await blockRewardHbbft.snapshotPoolTotalStakeAmount.call(nextStakingEpoch, validators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //   }

    //   const validatorsToBeFinalized = (await validatorSetHbbft.validatorsToBeFinalized.call()).miningAddresses;
    //   validatorsToBeFinalized.length.should.be.equal(0);
    // });

    // it('staking epoch #10 started', async () => {
    //   const stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
    //   stakingEpochStartBlock.should.be.bignumber.equal(new BN(STAKING_EPOCH_START_BLOCK + STAKING_FIXED_EPOCH_DURATION * 10));
    //   await setCurrentBlockNumber(stakingEpochStartBlock);

    //   const {logs} = await validatorSetHbbft.emitInitiateChange().should.be.fulfilled;
    //   logs[0].event.should.be.equal("InitiateChange");
    //   logs[0].args.newSet.should.be.deep.equal([
    //     accounts[131],
    //     accounts[132],
    //     accounts[133]
    //   ]);

    //   (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(new BN(0));
    //   await callFinalizeChange();
    //   (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(stakingEpochStartBlock);
    //   let validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[131],
    //     accounts[132],
    //     accounts[133]
    //   ]);
    // });

    // it('  all current validators remove their pools during the epoch #10', async () => {
    //   const validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[131],
    //     accounts[132],
    //     accounts[133],
    //   ]);
    //   for (let i = 0; i < validators.length; i++) {
    //     const stakingAddress = await validatorSetHbbft.stakingByMiningAddress.call(validators[i]);
    //     await stakingHbbft.removeMyPool({from: stakingAddress}).should.be.fulfilled;
    //   }
    // });

    // it('  three other candidates are added during the epoch #10', async () => {
    //   const candidatesMiningAddresses = accounts.slice(141, 143 + 1); // accounts[141...143]
    //   const candidatesStakingAddresses = accounts.slice(144, 146 + 1); // accounts[144...146]

    //   for (let i = 0; i < candidatesMiningAddresses.length; i++) {
    //     // Mint some balance for each candidate (imagine that each candidate got the tokens from a bridge)
    //     const miningAddress = candidatesMiningAddresses[i];
    //     const stakingAddress = candidatesStakingAddresses[i];
    //     await erc677Token.mint(stakingAddress, candidateMinStake, {from: owner}).should.be.fulfilled;
    //     candidateMinStake.should.be.bignumber.equal(await erc677Token.balanceOf.call(stakingAddress));

    //     // Candidate places stake on themselves
    //     await stakingHbbft.addPool(candidateMinStake, miningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    //     '0x00000000000000000000000000000000', {from: stakingAddress}).should.be.fulfilled;
    //   }
    // });

    // it('  the last validator is removed as malicious', async () => {
    //   const stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
    //   const currentBlock = stakingEpochStartBlock.add(new BN(STAKING_FIXED_EPOCH_DURATION - 10));
    //   await setCurrentBlockNumber(currentBlock);

    //   (await validatorSetHbbft.emitInitiateChangeCallable.call()).should.be.equal(false);

    //   let result = await validatorSetHbbft.reportMalicious(accounts[133], currentBlock.sub(new BN(1)), [], {from: accounts[131]}).should.be.fulfilled;
    //   result.logs[0].event.should.be.equal("ReportedMalicious");
    //   result.logs[0].args.reportingValidator.should.be.equal(accounts[131]);
    //   result = await validatorSetHbbft.reportMalicious(accounts[133], currentBlock.sub(new BN(1)), [], {from: accounts[132]}).should.be.fulfilled;
    //   result.logs[0].event.should.be.equal("ReportedMalicious");
    //   result.logs[0].args.reportingValidator.should.be.equal(accounts[132]);

    //   (await validatorSetHbbft.emitInitiateChangeCallable.call()).should.be.equal(true);
    //   result = await validatorSetHbbft.emitInitiateChange().should.be.fulfilled;
    //   result.logs[0].event.should.be.equal("InitiateChange");
    //   result.logs[0].args.newSet.should.be.deep.equal([
    //     accounts[131],
    //     accounts[132]
    //   ]);

    //   // (await validatorSetHbbft.isValidatorBanned.call(accounts[133])).should.be.equal(true);
    // });

    // it('staking epoch #10 finished', async () => {
    //   const stakingEpoch = await stakingHbbft.stakingEpoch.call();
    //   stakingEpoch.should.be.bignumber.equal(new BN(10));

    //   const stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
    //   const stakingEpochEndBlock = stakingEpochStartBlock.add(new BN(STAKING_FIXED_EPOCH_DURATION)).sub(new BN(1));
    //   await setCurrentBlockNumber(stakingEpochEndBlock);

    //   let validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[131],
    //     accounts[132],
    //     accounts[133]
    //   ]);
    //   const blocksCreated = stakingEpochEndBlock.sub(await validatorSetHbbft.validatorSetApplyBlock.call()).div(new BN(validators.length));
    //   blocksCreated.should.be.bignumber.above(new BN(0));
    //   for (let i = 0; i < validators.length; i++) {
    //     await blockRewardHbbft.setBlocksCreated(stakingEpoch, validators[i], blocksCreated).should.be.fulfilled;
    //   }

    //   const blockRewardBalanceBeforeReward = await erc677Token.balanceOf.call(blockRewardHbbft.address);

    //   (await validatorSetHbbft.emitInitiateChangeCallable.call()).should.be.equal(false);
    //   await callReward();
    //   const nextStakingEpoch = stakingEpoch.add(new BN(1)); // 11
    //   (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(nextStakingEpoch);
    //   (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(new BN(0));
    //   (await validatorSetHbbft.emitInitiateChangeCallable.call()).should.be.equal(false);

    //   let rewardDistributed = new BN(0);
    //   for (let i = 0; i < validators.length; i++) {
    //     const epochPoolTokenReward = await blockRewardHbbft.epochPoolTokenReward.call(stakingEpoch, validators[i]);
    //     if (validators[i] == accounts[131] || validators[i] == accounts[132]) {
    //       epochPoolTokenReward.should.be.bignumber.above(new BN(0));
    //     } else {
    //       epochPoolTokenReward.should.be.bignumber.equal(new BN(0));
    //     }
    //     rewardDistributed = rewardDistributed.add(epochPoolTokenReward);
    //   }
    //   nativeRewardUndistributed = nativeRewardUndistributed.sub(rewardDistributed);
    //   nativeRewardUndistributed.should.be.bignumber.equal(await blockRewardHbbft.nativeRewardUndistributed.call());

    //   const blockRewardBalanceAfterReward = await erc677Token.balanceOf.call(blockRewardHbbft.address);

    //   blockRewardBalanceAfterReward.should.be.bignumber.equal(blockRewardBalanceBeforeReward.add(rewardDistributed));
    //   (await blockRewardHbbft.bridgeTokenFee.call()).should.be.bignumber.equal(new BN(0));
    //   (await blockRewardHbbft.bridgeNativeFee.call()).should.be.bignumber.equal(new BN(0));

    //   const pendingValidators = await validatorSetHbbft.getPendingValidators.call();
    //   pendingValidators.sortedEqual([
    //     accounts[141],
    //     accounts[142],
    //     accounts[143],
    //   ]);
    //   for (let i = 0; i < pendingValidators.length; i++) {
    //     (await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(nextStakingEpoch, pendingValidators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //     (await blockRewardHbbft.snapshotPoolTotalStakeAmount.call(nextStakingEpoch, pendingValidators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //   }

    //   validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[131],
    //     accounts[132],
    //     accounts[133],
    //   ]);
    //   for (let i = 0; i < validators.length; i++) {
    //     (await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(nextStakingEpoch, validators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //     (await blockRewardHbbft.snapshotPoolTotalStakeAmount.call(nextStakingEpoch, validators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //   }

    //   const validatorsToBeFinalized = (await validatorSetHbbft.validatorsToBeFinalized.call()).miningAddresses;
    //   validatorsToBeFinalized.sortedEqual([
    //     accounts[131],
    //     accounts[132]
    //   ]);
    // });

    // it('staking epoch #11 started', async () => {
    //   const stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
    //   stakingEpochStartBlock.should.be.bignumber.equal(new BN(STAKING_EPOCH_START_BLOCK + STAKING_FIXED_EPOCH_DURATION * 11));
    //   await setCurrentBlockNumber(stakingEpochStartBlock);

    //   (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(new BN(0));
    //   await callFinalizeChange();
    //   (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(new BN(0));

    //   const validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[131],
    //     accounts[132]
    //   ]);

    //   const {logs} = await validatorSetHbbft.emitInitiateChange().should.be.fulfilled;
    //   logs[0].event.should.be.equal("InitiateChange");
    //   logs[0].args.newSet.should.be.deep.equal([
    //     accounts[141],
    //     accounts[142],
    //     accounts[143]
    //   ]);
    // });

    // it('  all pending validators remove their pools during the epoch #11', async () => {
    //   const pendingValidators = await validatorSetHbbft.getPendingValidators.call();
    //   pendingValidators.sortedEqual([
    //     accounts[141],
    //     accounts[142],
    //     accounts[143],
    //   ]);
    //   for (let i = 0; i < pendingValidators.length; i++) {
    //     const stakingAddress = await validatorSetHbbft.stakingByMiningAddress.call(pendingValidators[i]);
    //     await stakingHbbft.removeMyPool({from: stakingAddress}).should.be.fulfilled;
    //   }
    // });

    // it('  three other candidates are added during the epoch #11', async () => {
    //   const candidatesMiningAddresses = accounts.slice(151, 153 + 1); // accounts[151...153]
    //   const candidatesStakingAddresses = accounts.slice(154, 156 + 1); // accounts[154...156]

    //   for (let i = 0; i < candidatesMiningAddresses.length; i++) {
    //     // Mint some balance for each candidate (imagine that each candidate got the tokens from a bridge)
    //     const miningAddress = candidatesMiningAddresses[i];
    //     const stakingAddress = candidatesStakingAddresses[i];
    //     await erc677Token.mint(stakingAddress, candidateMinStake, {from: owner}).should.be.fulfilled;
    //     candidateMinStake.should.be.bignumber.equal(await erc677Token.balanceOf.call(stakingAddress));

    //     // Candidate places stake on themselves
    //     await stakingHbbft.addPool(candidateMinStake, miningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    //     '0x00000000000000000000000000000000', {from: stakingAddress}).should.be.fulfilled;

    //   }
    // });

    // it('staking epoch #11 finished', async () => {
    //   const stakingEpoch = await stakingHbbft.stakingEpoch.call();
    //   stakingEpoch.should.be.bignumber.equal(new BN(11));

    //   const stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
    //   const stakingEpochEndBlock = stakingEpochStartBlock.add(new BN(STAKING_FIXED_EPOCH_DURATION)).sub(new BN(1));
    //   await setCurrentBlockNumber(stakingEpochEndBlock);

    //   let validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[131],
    //     accounts[132]
    //   ]);
    //   for (let i = 0; i < validators.length; i++) {
    //     await blockRewardHbbft.setBlocksCreated(stakingEpoch, validators[i], new BN(0)).should.be.fulfilled;
    //   }
    //   (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(new BN(0));

    //   const blockRewardBalanceBeforeReward = await erc677Token.balanceOf.call(blockRewardHbbft.address);

    //   (await validatorSetHbbft.emitInitiateChangeCallable.call()).should.be.equal(false);
    //   await callReward();
    //   const nextStakingEpoch = stakingEpoch.add(new BN(1)); // 12
    //   (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(nextStakingEpoch);
    //   (await validatorSetHbbft.emitInitiateChangeCallable.call()).should.be.equal(false);

    //   for (let i = 0; i < validators.length; i++) {
    //     const epochPoolTokenReward = await blockRewardHbbft.epochPoolTokenReward.call(stakingEpoch, validators[i]);
    //     epochPoolTokenReward.should.be.bignumber.equal(new BN(0));
    //   }
    //   nativeRewardUndistributed.should.be.bignumber.equal(await blockRewardHbbft.nativeRewardUndistributed.call());

    //   const blockRewardBalanceAfterReward = await erc677Token.balanceOf.call(blockRewardHbbft.address);

    //   blockRewardBalanceAfterReward.should.be.bignumber.equal(blockRewardBalanceBeforeReward);
    //   (await blockRewardHbbft.bridgeTokenFee.call()).should.be.bignumber.equal(new BN(0));
    //   (await blockRewardHbbft.bridgeNativeFee.call()).should.be.bignumber.equal(new BN(0));

    //   const pendingValidators = await validatorSetHbbft.getPendingValidators.call();
    //   pendingValidators.sortedEqual([
    //     accounts[151],
    //     accounts[152],
    //     accounts[153],
    //   ]);
    //   for (let i = 0; i < pendingValidators.length; i++) {
    //     (await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(nextStakingEpoch, pendingValidators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //     (await blockRewardHbbft.snapshotPoolTotalStakeAmount.call(nextStakingEpoch, pendingValidators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //   }

    //   validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[131],
    //     accounts[132]
    //   ]);
    //   for (let i = 0; i < validators.length; i++) {
    //     (await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(nextStakingEpoch, validators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //     (await blockRewardHbbft.snapshotPoolTotalStakeAmount.call(nextStakingEpoch, validators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //   }

    //   const validatorsToBeFinalized = (await validatorSetHbbft.validatorsToBeFinalized.call()).miningAddresses;
    //   validatorsToBeFinalized.sortedEqual([
    //     accounts[141],
    //     accounts[142],
    //     accounts[143]
    //   ]);
    //   for (let i = 0; i < validatorsToBeFinalized.length; i++) {
    //     (await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(nextStakingEpoch, validatorsToBeFinalized[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //     (await blockRewardHbbft.snapshotPoolTotalStakeAmount.call(nextStakingEpoch, validatorsToBeFinalized[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //   }
    // });

    // it('staking epoch #12 started', async () => {
    //   const stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
    //   stakingEpochStartBlock.should.be.bignumber.equal(new BN(STAKING_EPOCH_START_BLOCK + STAKING_FIXED_EPOCH_DURATION * 12));
    //   await setCurrentBlockNumber(stakingEpochStartBlock);

    //   (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(new BN(0));
    //   await callFinalizeChange();
    //   (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(stakingEpochStartBlock);
    //   let validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[141],
    //     accounts[142],
    //     accounts[143]
    //   ]);

    //   const {logs} = await validatorSetHbbft.emitInitiateChange().should.be.fulfilled;
    //   logs[0].event.should.be.equal("InitiateChange");
    //   logs[0].args.newSet.should.be.deep.equal([
    //     accounts[151],
    //     accounts[152],
    //     accounts[153]
    //   ]);

    //   const currentBlock = stakingEpochStartBlock.add(new BN(10));
    //   await setCurrentBlockNumber(currentBlock);

    //   await callFinalizeChange();
    //   (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(currentBlock);
    //   validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[151],
    //     accounts[152],
    //     accounts[153]
    //   ]);
    // });

    // it('staking epoch #12 finished', async () => {
    //   const stakingEpoch = await stakingHbbft.stakingEpoch.call();
    //   stakingEpoch.should.be.bignumber.equal(new BN(12));

    //   const stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
    //   const stakingEpochEndBlock = stakingEpochStartBlock.add(new BN(STAKING_FIXED_EPOCH_DURATION)).sub(new BN(1));
    //   await setCurrentBlockNumber(stakingEpochEndBlock);

    //   let validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[151],
    //     accounts[152],
    //     accounts[153]
    //   ]);
    //   const blocksCreated = stakingEpochEndBlock.sub(await validatorSetHbbft.validatorSetApplyBlock.call()).div(new BN(validators.length));
    //   blocksCreated.should.be.bignumber.above(new BN(0));
    //   for (let i = 0; i < validators.length; i++) {
    //     await blockRewardHbbft.setBlocksCreated(stakingEpoch, validators[i], blocksCreated).should.be.fulfilled;
    //   }

    //   const blockRewardBalanceBeforeReward = await erc677Token.balanceOf.call(blockRewardHbbft.address);

    //   (await validatorSetHbbft.emitInitiateChangeCallable.call()).should.be.equal(false);
    //   await callReward();
    //   const nextStakingEpoch = stakingEpoch.add(new BN(1)); // 13
    //   (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(nextStakingEpoch);
    //   (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(new BN(0));
    //   (await validatorSetHbbft.emitInitiateChangeCallable.call()).should.be.equal(true);

    //   let rewardDistributed = new BN(0);
    //   for (let i = 0; i < validators.length; i++) {
    //     const epochPoolTokenReward = await blockRewardHbbft.epochPoolTokenReward.call(stakingEpoch, validators[i]);
    //     epochPoolTokenReward.should.be.bignumber.above(new BN(0));
    //     rewardDistributed = rewardDistributed.add(epochPoolTokenReward);
    //   }
    //   nativeRewardUndistributed = nativeRewardUndistributed.sub(rewardDistributed);
    //   nativeRewardUndistributed.should.be.bignumber.equal(await blockRewardHbbft.nativeRewardUndistributed.call());

    //   const blockRewardBalanceAfterReward = await erc677Token.balanceOf.call(blockRewardHbbft.address);

    //   blockRewardBalanceAfterReward.should.be.bignumber.equal(blockRewardBalanceBeforeReward.add(rewardDistributed));
    //   (await blockRewardHbbft.bridgeTokenFee.call()).should.be.bignumber.equal(new BN(0));
    //   (await blockRewardHbbft.bridgeNativeFee.call()).should.be.bignumber.equal(new BN(0));

    //   const pendingValidators = await validatorSetHbbft.getPendingValidators.call();
    //   pendingValidators.sortedEqual([
    //     accounts[151],
    //     accounts[152],
    //     accounts[153],
    //   ]);
    //   for (let i = 0; i < pendingValidators.length; i++) {
    //     (await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(nextStakingEpoch, pendingValidators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //     (await blockRewardHbbft.snapshotPoolTotalStakeAmount.call(nextStakingEpoch, pendingValidators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //   }

    //   validators = await validatorSetHbbft.getValidators.call();
    //   validators.sortedEqual([
    //     accounts[151],
    //     accounts[152],
    //     accounts[153],
    //   ]);
    //   for (let i = 0; i < validators.length; i++) {
    //     (await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(nextStakingEpoch, validators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //     (await blockRewardHbbft.snapshotPoolTotalStakeAmount.call(nextStakingEpoch, validators[i])).should.be.bignumber.equal(
    //       candidateMinStake
    //     );
    //   }

    //   const validatorsToBeFinalized = (await validatorSetHbbft.validatorsToBeFinalized.call()).miningAddresses;
    //   validatorsToBeFinalized.length.should.be.equal(0);
    // });
  });

  Array.prototype.sortedEqual = function(arr) {
    [...this].sort().should.be.deep.equal([...arr].sort());
  }

  async function callFinalizeChange() {
    await validatorSetHbbft.setSystemAddress(owner).should.be.fulfilled;
    await validatorSetHbbft.finalizeChange({from: owner}).should.be.fulfilled;
    await validatorSetHbbft.setSystemAddress('0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE').should.be.fulfilled;
  }

  async function callReward(isEpochEndBlock) {
    const validators = await validatorSetHbbft.getValidators.call();
    await blockRewardHbbft.setSystemAddress(owner).should.be.fulfilled;
    await blockRewardHbbft.reward([validators[0]], [0], isEpochEndBlock, {from: owner}).should.be.fulfilled;
    await blockRewardHbbft.setSystemAddress('0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE').should.be.fulfilled;
  }

  async function setCurrentBlockNumber(blockNumber) {
    await blockRewardHbbft.setCurrentBlockNumber(blockNumber).should.be.fulfilled;
    await randomHbbft.setCurrentBlockNumber(blockNumber).should.be.fulfilled;
    await stakingHbbft.setCurrentBlockNumber(blockNumber).should.be.fulfilled;
    await validatorSetHbbft.setCurrentBlockNumber(blockNumber).should.be.fulfilled;
  }

  // TODO: ...add other tests...
});
