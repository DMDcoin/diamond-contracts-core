const BlockRewardHbbft = artifacts.require('BlockRewardHbbftTokensMock');
const ERC677BridgeTokenRewardable = artifacts.require('ERC677BridgeTokenRewardableMock');
const AdminUpgradeabilityProxy = artifacts.require('AdminUpgradeabilityProxy');
const RandomHbbft = artifacts.require('RandomHbbftMock');
const ValidatorSetHbbft = artifacts.require('ValidatorSetHbbftMock');
const StakingHbbftTokens = artifacts.require('StakingHbbftTokensMock');
const StakingHbbftCoins = artifacts.require('StakingHbbftCoinsMock');

const ERROR_MSG = 'VM Exception while processing transaction: revert';
const BN = web3.utils.BN;

const fp = require('lodash/fp');
require('chai')
  .use(require('chai-as-promised'))
  .use(require('chai-bn')(BN))
  .should();

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
    stakingHbbft = await StakingHbbftTokens.new();
    stakingHbbft = await AdminUpgradeabilityProxy.new(stakingHbbft.address, owner, []);
    stakingHbbft = await StakingHbbftTokens.at(stakingHbbft.address);
    // Deploy ValidatorSet contract
    validatorSetHbbft = await ValidatorSetHbbft.new();
    validatorSetHbbft = await AdminUpgradeabilityProxy.new(validatorSetHbbft.address, owner, []);
    validatorSetHbbft = await ValidatorSetHbbft.at(validatorSetHbbft.address);

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

    // Initialize ValidatorSet
    await validatorSetHbbft.initialize(
      blockRewardHbbft.address, // _blockRewardContract
      randomHbbft.address, // _randomContract
      stakingHbbft.address, // _stakingContract
      initialValidators, // _initialMiningAddresses
      initialStakingAddresses, // _initialStakingAddresses
      false // _firstValidatorIsUnremovable
    ).should.be.fulfilled;
  });

  describe('addPool()', async () => {
    let candidateMiningAddress;
    let candidateStakingAddress;
    let erc677Token;
    let stakeUnit;

    beforeEach(async () => {
      candidateMiningAddress = accounts[7];
      candidateStakingAddress = accounts[8];

      // Initialize StakingHbbft
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        web3.utils.toWei('1', 'ether'), // _delegatorMinStake
        web3.utils.toWei('1', 'ether'), // _candidateMinStake
        120954, // _stakingEpochDuration
        0, // _stakingEpochStartBlock
        4320, // _stakeWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.fulfilled;

      // Deploy ERC677 contract
      erc677Token = await ERC677BridgeTokenRewardable.new("STAKE", "STAKE", 18, {from: owner});

      // Mint some balance for candidate (imagine that the candidate got 2 STAKE_UNITs from a bridge)
      stakeUnit = new BN(web3.utils.toWei('1', 'ether'));
      const mintAmount = stakeUnit.mul(new BN(2));
      await erc677Token.mint(candidateStakingAddress, mintAmount, {from: owner}).should.be.fulfilled;
      mintAmount.should.be.bignumber.equal(await erc677Token.balanceOf.call(candidateStakingAddress));

      // Pass Staking contract address to ERC677 contract
      await erc677Token.setStakingContract(stakingHbbft.address, {from: owner}).should.be.fulfilled;
      stakingHbbft.address.should.be.equal(
        await erc677Token.stakingContract.call()
      );

      // Pass ERC677 contract address to Staking contract
      '0x0000000000000000000000000000000000000000'.should.be.equal(
        await stakingHbbft.erc677TokenContract.call()
      );
      await stakingHbbft.setErc677TokenContract(erc677Token.address, {from: owner}).should.be.fulfilled;
      erc677Token.address.should.be.equal(
        await stakingHbbft.erc677TokenContract.call()
      );

      // Emulate block number
      await stakingHbbft.setCurrentBlockNumber(2).should.be.fulfilled;
      await validatorSetHbbft.setCurrentBlockNumber(2).should.be.fulfilled;
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
      await stakingHbbft.addPool(stakeUnit.mul(new BN(1)), candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress}).should.be.fulfilled;
      true.should.be.equal(await stakingHbbft.isPoolActive.call(candidateStakingAddress));
    });
    it('should fail if mining address is 0', async () => {
      await stakingHbbft.addPool(stakeUnit.mul(new BN(1)), '0x0000000000000000000000000000000000000000', '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.addPool(stakeUnit.mul(new BN(1)), candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress}).should.be.fulfilled;
    });
    it('should fail if mining address is equal to staking', async () => {
      await stakingHbbft.addPool(stakeUnit.mul(new BN(1)), candidateStakingAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress}).should.be.rejectedWith(ERROR_MSG);
    });
    it('should fail if the pool with the same mining/staking address is already existed', async () => {
      const candidateMiningAddress2 = accounts[9];
      const candidateStakingAddress2 = accounts[10];

      await stakingHbbft.addPool(stakeUnit.mul(new BN(1)), candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress}).should.be.fulfilled;

      await erc677Token.mint(candidateMiningAddress, stakeUnit.mul(new BN(2)), {from: owner}).should.be.fulfilled;
      await erc677Token.mint(candidateMiningAddress2, stakeUnit.mul(new BN(2)), {from: owner}).should.be.fulfilled;
      await erc677Token.mint(candidateStakingAddress2, stakeUnit.mul(new BN(2)), {from: owner}).should.be.fulfilled;

      await stakingHbbft.addPool(stakeUnit.mul(new BN(1)), candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress2}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.addPool(stakeUnit.mul(new BN(1)), candidateMiningAddress2, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress}).should.be.rejectedWith(ERROR_MSG);

      await stakingHbbft.addPool(stakeUnit.mul(new BN(1)), candidateStakingAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateMiningAddress2}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.addPool(stakeUnit.mul(new BN(1)), candidateStakingAddress2, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateMiningAddress}).should.be.rejectedWith(ERROR_MSG);

      await stakingHbbft.addPool(stakeUnit.mul(new BN(1)), candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000',{from: candidateMiningAddress2}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.addPool(stakeUnit.mul(new BN(1)), candidateMiningAddress2, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateMiningAddress}).should.be.rejectedWith(ERROR_MSG);

      await stakingHbbft.addPool(stakeUnit.mul(new BN(1)), candidateStakingAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress2}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.addPool(stakeUnit.mul(new BN(1)), candidateStakingAddress2, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress}).should.be.rejectedWith(ERROR_MSG);

      await stakingHbbft.addPool(stakeUnit.mul(new BN(1)), candidateMiningAddress2, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress2}).should.be.fulfilled;
    });
    it('should fail if gasPrice is 0', async () => {
      await stakingHbbft.addPool(stakeUnit.mul(new BN(1)), candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress, gasPrice: 0}).should.be.rejectedWith(ERROR_MSG);
    });
    it('should fail if ERC contract is not specified', async () => {
      // Set ERC677 contract address to zero
      await stakingHbbft.setErc677TokenContractMock('0x0000000000000000000000000000000000000000').should.be.fulfilled;

      // Try to add a new pool
      await stakingHbbft.addPool(stakeUnit.mul(new BN(1)), candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress}).should.be.rejectedWith(ERROR_MSG);
      false.should.be.equal(await stakingHbbft.isPoolActive.call(candidateStakingAddress));

      // Pass ERC677 contract address to ValidatorSet contract
      await stakingHbbft.setErc677TokenContract(erc677Token.address, {from: owner}).should.be.fulfilled;

      // Add a new pool
      await stakingHbbft.addPool(stakeUnit.mul(new BN(1)), candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress}).should.be.fulfilled;
      true.should.be.equal(await stakingHbbft.isPoolActive.call(candidateStakingAddress));
    });
    it('should fail if staking amount is 0', async () => {
      await stakingHbbft.addPool(new BN(0), candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress}).should.be.rejectedWith(ERROR_MSG);
    });
    it('should fail if block.number is inside disallowed range', async () => {
      await stakingHbbft.setCurrentBlockNumber(119960).should.be.fulfilled;
      await validatorSetHbbft.setCurrentBlockNumber(119960).should.be.fulfilled;
      await stakingHbbft.addPool(stakeUnit.mul(new BN(1)), candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.setCurrentBlockNumber(116560).should.be.fulfilled;
      await validatorSetHbbft.setCurrentBlockNumber(116560).should.be.fulfilled;
      await stakingHbbft.addPool(stakeUnit.mul(new BN(1)), candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress}).should.be.fulfilled;
    });
    it('should fail if staking amount is less than CANDIDATE_MIN_STAKE', async () => {
      await stakingHbbft.addPool(stakeUnit.mul(new BN(1)).div(new BN(2)), candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.addPool(stakeUnit.mul(new BN(1)), candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress}).should.be.fulfilled;
    });
    it('should fail if candidate doesn\'t have enough funds', async () => {
      await stakingHbbft.addPool(stakeUnit.mul(new BN(3)), candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.addPool(stakeUnit.mul(new BN(2)), candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress}).should.be.fulfilled;
    });
    it('stake amount should be increased', async () => {
      const amount = stakeUnit.mul(new BN(2));
      await stakingHbbft.addPool(amount, candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress}).should.be.fulfilled;
      amount.should.be.bignumber.equal(await stakingHbbft.stakeAmount.call(candidateStakingAddress, candidateStakingAddress));
      amount.should.be.bignumber.equal(await stakingHbbft.stakeAmountByCurrentEpoch.call(candidateStakingAddress, candidateStakingAddress));
      amount.should.be.bignumber.equal(await stakingHbbft.stakeAmountTotal.call(candidateStakingAddress));
    });
    it('should be able to add more than one pool', async () => {
      const candidate1MiningAddress = candidateMiningAddress;
      const candidate1StakingAddress = candidateStakingAddress;
      const candidate2MiningAddress = accounts[9];
      const candidate2StakingAddress = accounts[10];
      const amount1 = stakeUnit.mul(new BN(2));
      const amount2 = stakeUnit.mul(new BN(3));

      // Emulate having necessary amount for the candidate #2
      await erc677Token.mint(candidate2StakingAddress, amount2, {from: owner}).should.be.fulfilled;
      amount2.should.be.bignumber.equal(await erc677Token.balanceOf.call(candidate2StakingAddress));

      // Add two new pools
      (await stakingHbbft.isPoolActive.call(candidate1StakingAddress)).should.be.equal(false);
      (await stakingHbbft.isPoolActive.call(candidate2StakingAddress)).should.be.equal(false);
      await stakingHbbft.addPool(amount1, candidate1MiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidate1StakingAddress}).should.be.fulfilled;
      await stakingHbbft.addPool(amount2, candidate2MiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidate2StakingAddress}).should.be.fulfilled;
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

      // Try to add a new pool outside of max limit
      await stakingHbbft.addPool(stakeUnit.mul(new BN(1)), candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress}).should.be.rejectedWith(ERROR_MSG);
      false.should.be.equal(await stakingHbbft.isPoolActive.call(candidateStakingAddress));
    });
    it('should remove added pool from the list of inactive pools', async () => {
      await stakingHbbft.addPoolInactiveMock(candidateStakingAddress).should.be.fulfilled;
      (await stakingHbbft.getPoolsInactive.call()).should.be.deep.equal([candidateStakingAddress]);
      await stakingHbbft.addPool(stakeUnit.mul(new BN(1)), candidateMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '0x00000000000000000000000000000000', {from: candidateStakingAddress}).should.be.fulfilled;
      true.should.be.equal(await stakingHbbft.isPoolActive.call(candidateStakingAddress));
      (await stakingHbbft.getPoolsInactive.call()).length.should.be.equal(0);
    });
  });

  describe('balance', async () => {
    let erc677Token;
    let mintAmount;

    beforeEach(async () => {
      // Deploy ERC677 contract
      erc677Token = await ERC677BridgeTokenRewardable.new("STAKE", "STAKE", 18, {from: owner});

      // Mint some balance for an arbitrary address
      const stakeUnit = new BN(web3.utils.toWei('1', 'ether'));
      mintAmount = stakeUnit.mul(new BN(2));
      await erc677Token.mint(accounts[10], mintAmount, {from: owner}).should.be.fulfilled;
      mintAmount.should.be.bignumber.equal(await erc677Token.balanceOf.call(accounts[10]));

      // Pass Staking contract address to ERC677 contract
      await erc677Token.setStakingContract(stakingHbbft.address, {from: owner}).should.be.fulfilled;
      stakingHbbft.address.should.be.equal(
        await erc677Token.stakingContract.call()
      );
    });

    it('cannot be increased by token.transfer function', async () => {
      await erc677Token.transfer(stakingHbbft.address, mintAmount, {from: accounts[10]}).should.be.rejectedWith(ERROR_MSG);
      await erc677Token.transfer(accounts[11], mintAmount, {from: accounts[10]}).should.be.fulfilled;
    });
    it('cannot be increased by token.transferFrom function', async () => {
      await erc677Token.approve(accounts[9], mintAmount, {from: accounts[10]}).should.be.fulfilled;
      await erc677Token.transferFrom(accounts[10], stakingHbbft.address, mintAmount, {from: accounts[9]}).should.be.rejectedWith(ERROR_MSG);
      await erc677Token.transferFrom(accounts[10], accounts[11], mintAmount, {from: accounts[9]}).should.be.fulfilled;
    });
    it('cannot be increased by token.transferAndCall function', async () => {
      await erc677Token.transferAndCall(stakingHbbft.address, mintAmount, [], {from: accounts[10]}).should.be.rejectedWith(ERROR_MSG);
      await erc677Token.transferAndCall(accounts[11], mintAmount, [], {from: accounts[10]}).should.be.fulfilled;
    });
    it('cannot be increased by sending native coins', async () => {
      await web3.eth.sendTransaction({from: owner, to: stakingHbbft.address, value: 1}).should.be.rejectedWith(ERROR_MSG);
      await web3.eth.sendTransaction({from: owner, to: accounts[1], value: 1}).should.be.fulfilled;
    });
  });

  describe('claimReward()', async () => {
    let delegator;
    let delegatorMinStake;
    let erc677Token;

    beforeEach(async () => {
      // Initialize BlockRewardHbbft
      await blockRewardHbbft.initialize(
        validatorSetHbbft.address
      ).should.be.fulfilled;

      // Initialize RandomHbbft
      await randomHbbft.initialize(
        validatorSetHbbft.address
      ).should.be.fulfilled;

      // Initialize StakingHbbft
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        web3.utils.toWei('1', 'ether'), // _delegatorMinStake
        web3.utils.toWei('1', 'ether'), // _candidateMinStake
        120954, // _stakingEpochDuration
        0, // _stakingEpochStartBlock
        4320, // _stakeWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.fulfilled;

      // Start the network
      await setCurrentBlockNumber(1);
      await callFinalizeChange();
      (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(new BN(1));

      // Deploy ERC677 contract
      erc677Token = await ERC677BridgeTokenRewardable.new("STAKE", "STAKE", 18, {from: owner});
      await stakingHbbft.setErc677TokenContract(erc677Token.address, {from: owner}).should.be.fulfilled;
      await erc677Token.setBlockRewardContract(blockRewardHbbft.address).should.be.fulfilled;
      await erc677Token.setStakingContract(stakingHbbft.address).should.be.fulfilled;

      // Validators place stakes during the epoch #0
      const candidateMinStake = await stakingHbbft.candidateMinStake.call();
      for (let i = 0; i < initialStakingAddresses.length; i++) {
        // Mint some balance for each validator (imagine that each validator got the tokens from a bridge)
        await erc677Token.mint(initialStakingAddresses[i], candidateMinStake, {from: owner}).should.be.fulfilled;
        candidateMinStake.should.be.bignumber.equal(await erc677Token.balanceOf.call(initialStakingAddresses[i]));

        // Validator places stake on themselves
        await stakingHbbft.stake(initialStakingAddresses[i], candidateMinStake, {from: initialStakingAddresses[i]}).should.be.fulfilled;
      }

      // Mint some balance for a delegator (imagine that the delegator got the tokens from a bridge)
      delegator = accounts[10];
      delegatorMinStake = await stakingHbbft.delegatorMinStake.call();
      await erc677Token.mint(delegator, delegatorMinStake, {from: owner}).should.be.fulfilled;
      delegatorMinStake.should.be.bignumber.equal(await erc677Token.balanceOf.call(delegator));

      // The delegator places stake on the first validator
      await stakingHbbft.stake(initialStakingAddresses[0], delegatorMinStake, {from: delegator}).should.be.fulfilled;

      // Staking epoch #0 finishes
      const stakingEpochEndBlock = (await stakingHbbft.stakingEpochStartBlock.call()).add(new BN(120954));
      await setCurrentBlockNumber(stakingEpochEndBlock);

      const blocksCreated = stakingEpochEndBlock.sub(await validatorSetHbbft.validatorSetApplyBlock.call()).div(new BN(initialValidators.length));
      blocksCreated.should.be.bignumber.above(new BN(0));
      for (let i = 0; i < initialValidators.length; i++) {
        await blockRewardHbbft.setBlocksCreated(new BN(0), initialValidators[i], blocksCreated).should.be.fulfilled;
      }

      await callReward();
    });

    async function _claimRewardStakeIncreasing(epochsPoolRewarded, epochsStakeIncreased) {
      const miningAddress = initialValidators[0];
      const stakingAddress = initialStakingAddresses[0];
      const epochPoolReward = new BN(web3.utils.toWei('1', 'ether'));
      const maxStakingEpoch = Math.max(Math.max.apply(null, epochsPoolRewarded), Math.max.apply(null, epochsStakeIncreased));

      (await erc677Token.balanceOf.call(blockRewardHbbft.address)).should.be.bignumber.equal(new BN(0));
      (await web3.eth.getBalance(blockRewardHbbft.address)).should.be.equal('0');

      // Emulate rewards for the pool
      for (let i = 0; i < epochsPoolRewarded.length; i++) {
        const stakingEpoch = epochsPoolRewarded[i];
        await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, epochPoolReward, {value: epochPoolReward}).should.be.fulfilled;
      }

      (await erc677Token.balanceOf.call(blockRewardHbbft.address)).should.be.bignumber.equal(epochPoolReward.mul(new BN(epochsPoolRewarded.length)));
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(epochPoolReward.mul(new BN(epochsPoolRewarded.length)));

      let prevStakingEpoch = 0;
      const validatorStakeAmount = await stakingHbbft.stakeAmount.call(stakingAddress, stakingAddress);
      let stakeAmount = await stakingHbbft.stakeAmount.call(stakingAddress, delegator);
      let stakeAmountOnEpoch = [new BN(0)];

      let s = 0;
      for (let epoch = 1; epoch <= maxStakingEpoch; epoch++) {
        const stakingEpoch = epochsStakeIncreased[s];

        if (stakingEpoch == epoch) {
          const stakingEpochStartBlock = new BN(120954 * stakingEpoch + 1);
          await stakingHbbft.setStakingEpoch(stakingEpoch).should.be.fulfilled;
          await stakingHbbft.setValidatorSetAddress(owner).should.be.fulfilled;
          await stakingHbbft.setStakingEpochStartBlock(stakingEpochStartBlock).should.be.fulfilled;
          await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
          await setCurrentBlockNumber(stakingEpochStartBlock);

          // Emulate delegator's stake increasing
          await erc677Token.mint(delegator, delegatorMinStake, {from: owner}).should.be.fulfilled;
          delegatorMinStake.should.be.bignumber.equal(await erc677Token.balanceOf.call(delegator));
          await stakingHbbft.stake(stakingAddress, delegatorMinStake, {from: delegator}).should.be.fulfilled;

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
      let stakingEpoch = 1;
      let stakingEpochStartBlock = new BN(120954 * stakingEpoch + 1);
      await stakingHbbft.setValidatorSetAddress(owner).should.be.fulfilled;
      await stakingHbbft.setStakingEpochStartBlock(stakingEpochStartBlock).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
      await setCurrentBlockNumber(stakingEpochStartBlock);
      await callFinalizeChange();

      await stakingHbbft.orderWithdraw(stakingAddress, delegatorMinStake, {from: delegator}).should.be.fulfilled;

      let stakingEpochEndBlock = stakingEpochStartBlock.add(new BN(120954 - 1));
      await setCurrentBlockNumber(stakingEpochEndBlock);

      let blocksCreated = stakingEpochEndBlock.sub(await validatorSetHbbft.validatorSetApplyBlock.call()).div(new BN(initialValidators.length));
      blocksCreated.should.be.bignumber.above(new BN(0));
      for (let i = 0; i < initialValidators.length; i++) {
        await blockRewardHbbft.setBlocksCreated(new BN(stakingEpoch), initialValidators[i], blocksCreated).should.be.fulfilled;
      }
      await callReward();

      stakingEpoch = 2;
      stakingEpochStartBlock = new BN(120954 * stakingEpoch + 1);
      await stakingHbbft.setValidatorSetAddress(owner).should.be.fulfilled;
      await stakingHbbft.setStakingEpochStartBlock(stakingEpochStartBlock).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
      await setCurrentBlockNumber(stakingEpochStartBlock);
      await callFinalizeChange();

      await stakingHbbft.claimOrderedWithdraw(stakingAddress, {from: delegator}).should.be.fulfilled;
      (await stakingHbbft.stakeAmount.call(stakingAddress, delegator)).should.be.bignumber.equal(new BN(0));
      (await stakingHbbft.orderedWithdrawAmount.call(stakingAddress, delegator)).should.be.bignumber.equal(new BN(0));

      (await stakingHbbft.stakeFirstEpoch.call(stakingAddress, delegator)).should.be.bignumber.equal(new BN(1));
      (await stakingHbbft.stakeLastEpoch.call(stakingAddress, delegator)).should.be.bignumber.equal(new BN(2));

      await stakingHbbft.setStakeFirstEpoch(stakingAddress, delegator, new BN(0)).should.be.fulfilled;
      await stakingHbbft.setStakeLastEpoch(stakingAddress, delegator, new BN(0)).should.be.fulfilled;
      await stakingHbbft.clearDelegatorStakeSnapshot(stakingAddress, delegator, new BN(1)).should.be.fulfilled;
      await stakingHbbft.clearDelegatorStakeSnapshot(stakingAddress, delegator, new BN(2)).should.be.fulfilled;

      stakingEpochEndBlock = stakingEpochStartBlock.add(new BN(120954 - 1));
      await setCurrentBlockNumber(stakingEpochEndBlock);

      blocksCreated = stakingEpochEndBlock.sub(await validatorSetHbbft.validatorSetApplyBlock.call()).div(new BN(initialValidators.length));
      blocksCreated.should.be.bignumber.above(new BN(0));
      for (let i = 0; i < initialValidators.length; i++) {
        await blockRewardHbbft.setBlocksCreated(new BN(stakingEpoch), initialValidators[i], blocksCreated).should.be.fulfilled;
      }
      await callReward();

      (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(new BN(3));

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

      const delegatorTokensBalanceBefore = await erc677Token.balanceOf.call(delegator);
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
      const delegatorTokensBalanceAfter = await erc677Token.balanceOf.call(delegator);
      const delegatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(delegator));

      delegatorTokensBalanceAfter.should.be.bignumber.equal(delegatorTokensBalanceBefore.add(delegatorRewardExpected));
      delegatorCoinsBalanceAfter.should.be.bignumber.equal(delegatorCoinsBalanceBefore.add(delegatorRewardExpected).sub(weiSpent));

      const validatorTokensBalanceBefore = await erc677Token.balanceOf.call(stakingAddress);
      const validatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(stakingAddress));
      weiSpent = new BN(0);
      shuffle(epochsPoolRewardedRandom);
      for (let i = 0; i < epochsPoolRewardedRandom.length; i++) {
        const stakingEpoch = epochsPoolRewardedRandom[i];
        const result = await stakingHbbft.claimReward([stakingEpoch], stakingAddress, {from: stakingAddress}).should.be.fulfilled;
        const tx = await web3.eth.getTransaction(result.tx);
        weiSpent = weiSpent.add((new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice)));
      }
      const validatorTokensBalanceAfter = await erc677Token.balanceOf.call(stakingAddress);
      const validatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(stakingAddress));

      validatorTokensBalanceAfter.should.be.bignumber.equal(validatorTokensBalanceBefore.add(validatorRewardExpected));
      validatorCoinsBalanceAfter.should.be.bignumber.equal(validatorCoinsBalanceBefore.add(validatorRewardExpected).sub(weiSpent));

      const blockRewardBalanceExpected = epochPoolReward.mul(new BN(epochsPoolRewarded.length)).sub(delegatorRewardExpected).sub(validatorRewardExpected);
      (await erc677Token.balanceOf.call(blockRewardHbbft.address)).should.be.bignumber.equal(blockRewardBalanceExpected);
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
      rewardAmountsCalculated.tokenRewardSum.should.be.bignumber.equal(delegatorRewardExpected);
      rewardAmountsCalculated.nativeRewardSum.should.be.bignumber.equal(delegatorRewardExpected);

      const delegatorTokensBalanceBefore = await erc677Token.balanceOf.call(delegator);
      const delegatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(delegator));
      const result = await stakingHbbft.claimReward([], stakingAddress, {from: delegator}).should.be.fulfilled;
      const tx = await web3.eth.getTransaction(result.tx);
      const weiSpent = (new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice));
      const delegatorTokensBalanceAfter = await erc677Token.balanceOf.call(delegator);
      const delegatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(delegator));

      delegatorTokensBalanceAfter.should.be.bignumber.equal(delegatorTokensBalanceBefore.add(delegatorRewardExpected));
      delegatorCoinsBalanceAfter.should.be.bignumber.equal(delegatorCoinsBalanceBefore.add(delegatorRewardExpected).sub(weiSpent));

      rewardAmountsCalculated = await stakingHbbft.getRewardAmount.call([], stakingAddress, stakingAddress);
      rewardAmountsCalculated.tokenRewardSum.should.be.bignumber.equal(validatorRewardExpected);
      rewardAmountsCalculated.nativeRewardSum.should.be.bignumber.equal(validatorRewardExpected);

      await stakingHbbft.claimReward([], stakingAddress, {from: stakingAddress}).should.be.fulfilled;

      const blockRewardBalanceExpected = epochPoolReward.mul(new BN(epochsPoolRewarded.length)).sub(delegatorRewardExpected).sub(validatorRewardExpected);
      (await erc677Token.balanceOf.call(blockRewardHbbft.address)).should.be.bignumber.equal(blockRewardBalanceExpected);
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(blockRewardBalanceExpected);
    }

    async function testClaimRewardAfterStakeMovements(epochsPoolRewarded, epochsStakeMovement) {
      const miningAddress = initialValidators[0];
      const stakingAddress = initialStakingAddresses[0];
      const epochPoolReward = new BN(web3.utils.toWei('1', 'ether'));

      (await erc677Token.balanceOf.call(blockRewardHbbft.address)).should.be.bignumber.equal(new BN(0));
      (await web3.eth.getBalance(blockRewardHbbft.address)).should.be.equal('0');

      for (let i = 0; i < epochsPoolRewarded.length; i++) {
        const stakingEpoch = epochsPoolRewarded[i];

        // Emulate snapshotting for the pool
        await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch, miningAddress).should.be.fulfilled;

        // Emulate rewards for the pool
        await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, epochPoolReward, {value: epochPoolReward}).should.be.fulfilled;
      }

      (await erc677Token.balanceOf.call(blockRewardHbbft.address)).should.be.bignumber.equal(epochPoolReward.mul(new BN(epochsPoolRewarded.length)));
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(epochPoolReward.mul(new BN(epochsPoolRewarded.length)));

      for (let i = 0; i < epochsStakeMovement.length; i++) {
        const stakingEpoch = epochsStakeMovement[i];

        // Emulate delegator's stake movement
        const stakingEpochStartBlock = new BN(120954 * stakingEpoch + 1);
        await stakingHbbft.setStakingEpoch(stakingEpoch).should.be.fulfilled;
        await stakingHbbft.setValidatorSetAddress(owner).should.be.fulfilled;
        await stakingHbbft.setStakingEpochStartBlock(stakingEpochStartBlock).should.be.fulfilled;
        await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
        await setCurrentBlockNumber(stakingEpochStartBlock);
        await stakingHbbft.orderWithdraw(stakingAddress, delegatorMinStake, {from: delegator}).should.be.fulfilled;
        await stakingHbbft.orderWithdraw(stakingAddress, delegatorMinStake.neg(), {from: delegator}).should.be.fulfilled;
      }

      const stakeFirstEpoch = await stakingHbbft.stakeFirstEpoch.call(stakingAddress, delegator);
      await stakingHbbft.setStakeFirstEpoch(stakingAddress, delegator, 0);
      await stakingHbbft.claimReward([], stakingAddress, {from: delegator}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.setStakeFirstEpoch(stakingAddress, delegator, stakeFirstEpoch);

      if (epochsPoolRewarded.length > 0) {
        if (epochsPoolRewarded.length > 1) {
          const reversedEpochsPoolRewarded = [...epochsPoolRewarded].reverse();
          await stakingHbbft.claimReward(reversedEpochsPoolRewarded, stakingAddress, {from: delegator}).should.be.rejectedWith(ERROR_MSG);
        }

        await stakingHbbft.setStakingEpoch(epochsPoolRewarded[epochsPoolRewarded.length - 1]).should.be.fulfilled;
        await stakingHbbft.claimReward([], stakingAddress, {from: delegator}).should.be.rejectedWith(ERROR_MSG);
        await stakingHbbft.setStakingEpoch(epochsPoolRewarded[epochsPoolRewarded.length - 1] + 1).should.be.fulfilled;

        if (epochsPoolRewarded.length == 1) {
          const validatorStakeAmount = await blockRewardHbbft.snapshotPoolValidatorStakeAmount.call(epochsPoolRewarded[0], miningAddress);
          await blockRewardHbbft.setSnapshotPoolValidatorStakeAmount(epochsPoolRewarded[0], miningAddress, 0);
          const result = await stakingHbbft.claimReward([], stakingAddress, {from: delegator}).should.be.fulfilled;
          result.logs.length.should.be.equal(1);
          result.logs[0].args.tokensAmount.should.be.bignumber.equal(new BN(0));
          result.logs[0].args.nativeCoinsAmount.should.be.bignumber.equal(new BN(0));
          await blockRewardHbbft.setSnapshotPoolValidatorStakeAmount(epochsPoolRewarded[0], miningAddress, validatorStakeAmount);
          await stakingHbbft.clearRewardWasTaken(stakingAddress, delegator, epochsPoolRewarded[0]);
        }
      }

      const delegatorRewardExpected = epochPoolReward.mul(new BN(epochsPoolRewarded.length)).div(new BN(2));

      const rewardAmountsCalculated = await stakingHbbft.getRewardAmount.call([], stakingAddress, delegator);
      rewardAmountsCalculated.tokenRewardSum.should.be.bignumber.equal(delegatorRewardExpected);
      rewardAmountsCalculated.nativeRewardSum.should.be.bignumber.equal(delegatorRewardExpected);

      const delegatorTokensBalanceBefore = await erc677Token.balanceOf.call(delegator);
      const delegatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(delegator));
      let weiSpent = new BN(0);
      for (let i = 0; i < 3; i++) {
        // We call `claimReward` several times, but it withdraws the reward only once
        const result = await stakingHbbft.claimReward([], stakingAddress, {from: delegator}).should.be.fulfilled;
        const tx = await web3.eth.getTransaction(result.tx);
        weiSpent = weiSpent.add((new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice)));
      }
      const delegatorTokensBalanceAfter = await erc677Token.balanceOf.call(delegator);
      const delegatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(delegator));

      delegatorTokensBalanceAfter.should.be.bignumber.equal(delegatorTokensBalanceBefore.add(delegatorRewardExpected));
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

      (await erc677Token.balanceOf.call(blockRewardHbbft.address)).should.be.bignumber.equal(new BN(0));
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
      await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, epochPoolReward, {value: epochPoolReward}).should.be.fulfilled;
      (await erc677Token.balanceOf.call(blockRewardHbbft.address)).should.be.bignumber.equal(epochPoolReward);
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(epochPoolReward);
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress).should.be.fulfilled;

      // Emulate the delegator's first stake on epoch #10
      stakingEpoch = 10;
      stakingEpochStartBlock = new BN(120954 * stakingEpoch + 1);
      await stakingHbbft.setStakingEpoch(stakingEpoch).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress(owner).should.be.fulfilled;
      await stakingHbbft.setStakingEpochStartBlock(stakingEpochStartBlock).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
      await setCurrentBlockNumber(stakingEpochStartBlock);
      await stakingHbbft.stake(stakingAddress, delegatorMinStake, {from: delegator}).should.be.fulfilled;
      await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, epochPoolReward, {value: epochPoolReward}).should.be.fulfilled;
      (await erc677Token.balanceOf.call(blockRewardHbbft.address)).should.be.bignumber.equal(epochPoolReward.mul(new BN(2)));
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(epochPoolReward.mul(new BN(2)));
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress).should.be.fulfilled;

      // Emulate rewards for the pool on epoch #11
      stakingEpoch = 11;
      await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, epochPoolReward, {value: epochPoolReward}).should.be.fulfilled;
      (await erc677Token.balanceOf.call(blockRewardHbbft.address)).should.be.bignumber.equal(epochPoolReward.mul(new BN(3)));
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(epochPoolReward.mul(new BN(3)));
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress).should.be.fulfilled;

      await stakingHbbft.setStakingEpoch(12).should.be.fulfilled;

      const rewardAmountsCalculated = await stakingHbbft.getRewardAmount.call([9, 10], stakingAddress, delegator);
      rewardAmountsCalculated.tokenRewardSum.should.be.bignumber.equal(new BN(0));
      rewardAmountsCalculated.nativeRewardSum.should.be.bignumber.equal(new BN(0));

      const delegatorTokensBalanceBefore = await erc677Token.balanceOf.call(delegator);
      const delegatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(delegator));
      let result = await stakingHbbft.claimReward([9, 10], stakingAddress, {from: delegator}).should.be.fulfilled;
      const tx = await web3.eth.getTransaction(result.tx);
      const weiSpent = (new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice));
      const delegatorTokensBalanceAfter = await erc677Token.balanceOf.call(delegator);
      const delegatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(delegator));

      result.logs.length.should.be.equal(0);
      delegatorTokensBalanceAfter.should.be.bignumber.equal(delegatorTokensBalanceBefore);
      delegatorCoinsBalanceAfter.should.be.bignumber.equal(delegatorCoinsBalanceBefore.sub(weiSpent));

      result = await stakingHbbft.claimReward([], stakingAddress, {from: stakingAddress}).should.be.fulfilled;
      result.logs.length.should.be.equal(3);
      result.logs[0].args.stakingEpoch.should.be.bignumber.equal(new BN(9));
      result.logs[1].args.stakingEpoch.should.be.bignumber.equal(new BN(10));
      result.logs[2].args.stakingEpoch.should.be.bignumber.equal(new BN(11));

      result = await stakingHbbft.claimReward([], stakingAddress, {from: delegator}).should.be.fulfilled;
      result.logs.length.should.be.equal(1);
      result.logs[0].args.stakingEpoch.should.be.bignumber.equal(new BN(11));

      (await erc677Token.balanceOf.call(blockRewardHbbft.address)).should.be.bignumber.equal(new BN(0));
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(new BN(0));

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
      await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, epochPoolReward, {value: epochPoolReward}).should.be.fulfilled;
      (await erc677Token.balanceOf.call(blockRewardHbbft.address)).should.be.bignumber.equal(epochPoolReward);
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(epochPoolReward);
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress).should.be.fulfilled;

      // Emulate the delegator's first stake and withdrawal on epoch #10
      stakingEpoch = 10;
      stakingEpochStartBlock = new BN(120954 * stakingEpoch + 1);
      await stakingHbbft.setStakingEpoch(stakingEpoch).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress(owner).should.be.fulfilled;
      await stakingHbbft.setStakingEpochStartBlock(stakingEpochStartBlock).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
      await setCurrentBlockNumber(stakingEpochStartBlock);
      await stakingHbbft.stake(stakingAddress, delegatorMinStake, {from: delegator}).should.be.fulfilled;
      await stakingHbbft.withdraw(stakingAddress, delegatorMinStake, {from: delegator}).should.be.fulfilled;
      await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, epochPoolReward, {value: epochPoolReward}).should.be.fulfilled;
      (await erc677Token.balanceOf.call(blockRewardHbbft.address)).should.be.bignumber.equal(epochPoolReward.mul(new BN(2)));
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(epochPoolReward.mul(new BN(2)));
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress).should.be.fulfilled;

      // Emulate rewards for the pool on epoch #11
      stakingEpoch = 11;
      await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, epochPoolReward, {value: epochPoolReward}).should.be.fulfilled;
      (await erc677Token.balanceOf.call(blockRewardHbbft.address)).should.be.bignumber.equal(epochPoolReward.mul(new BN(3)));
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(epochPoolReward.mul(new BN(3)));
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress).should.be.fulfilled;

      await stakingHbbft.setStakingEpoch(12).should.be.fulfilled;

      const rewardAmountsCalculated = await stakingHbbft.getRewardAmount.call([], stakingAddress, delegator);
      rewardAmountsCalculated.tokenRewardSum.should.be.bignumber.equal(new BN(0));
      rewardAmountsCalculated.nativeRewardSum.should.be.bignumber.equal(new BN(0));

      const delegatorTokensBalanceBefore = await erc677Token.balanceOf.call(delegator);
      const delegatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(delegator));
      let result = await stakingHbbft.claimReward([], stakingAddress, {from: delegator}).should.be.fulfilled;
      const tx = await web3.eth.getTransaction(result.tx);
      const weiSpent = (new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice));
      const delegatorTokensBalanceAfter = await erc677Token.balanceOf.call(delegator);
      const delegatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(delegator));

      result.logs.length.should.be.equal(0);
      delegatorTokensBalanceAfter.should.be.bignumber.equal(delegatorTokensBalanceBefore);
      delegatorCoinsBalanceAfter.should.be.bignumber.equal(delegatorCoinsBalanceBefore.sub(weiSpent));

      result = await stakingHbbft.claimReward([], stakingAddress, {from: stakingAddress}).should.be.fulfilled;
      result.logs.length.should.be.equal(3);
      result.logs[0].args.stakingEpoch.should.be.bignumber.equal(new BN(9));
      result.logs[1].args.stakingEpoch.should.be.bignumber.equal(new BN(10));
      result.logs[2].args.stakingEpoch.should.be.bignumber.equal(new BN(11));

      (await erc677Token.balanceOf.call(blockRewardHbbft.address)).should.be.bignumber.equal(new BN(0));
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(new BN(0));

      (await stakingHbbft.stakeFirstEpoch.call(stakingAddress, delegator)).should.be.bignumber.equal(new BN(11));
      (await stakingHbbft.stakeLastEpoch.call(stakingAddress, delegator)).should.be.bignumber.equal(new BN(11));
    });

    it('non-rewarded epochs are passed', async () => {
      const miningAddress = initialValidators[0];
      const stakingAddress = initialStakingAddresses[0];
      const epochPoolReward = new BN(web3.utils.toWei('1', 'ether'));

      (await erc677Token.balanceOf.call(blockRewardHbbft.address)).should.be.bignumber.equal(new BN(0));
      (await web3.eth.getBalance(blockRewardHbbft.address)).should.be.equal('0');

      const epochsPoolRewarded = [10, 20, 30, 40, 50];
      for (let i = 0; i < epochsPoolRewarded.length; i++) {
        const stakingEpoch = epochsPoolRewarded[i];

        // Emulate snapshotting for the pool
        await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch, miningAddress).should.be.fulfilled;

        // Emulate rewards for the pool
        await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, epochPoolReward, {value: epochPoolReward}).should.be.fulfilled;
      }

      (await erc677Token.balanceOf.call(blockRewardHbbft.address)).should.be.bignumber.equal(epochPoolReward.mul(new BN(epochsPoolRewarded.length)));
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(epochPoolReward.mul(new BN(epochsPoolRewarded.length)));

      await stakingHbbft.setStakingEpoch(51);

      const epochsToWithdrawFrom = [15, 25, 35, 45];
      const delegatorTokensBalanceBefore = await erc677Token.balanceOf.call(delegator);
      const delegatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(delegator));
      const result = await stakingHbbft.claimReward(epochsToWithdrawFrom, stakingAddress, {from: delegator}).should.be.fulfilled;
      const tx = await web3.eth.getTransaction(result.tx);
      const weiSpent = (new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice));
      const delegatorTokensBalanceAfter = await erc677Token.balanceOf.call(delegator);
      const delegatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(delegator));

      result.logs.length.should.be.equal(epochsToWithdrawFrom.length);
      for (let i = 0; i < result.logs.length; i++) {
        result.logs[i].args.stakingEpoch.should.be.bignumber.equal(new BN(epochsToWithdrawFrom[i]));
        result.logs[i].args.tokensAmount.should.be.bignumber.equal(new BN(0));
        result.logs[i].args.nativeCoinsAmount.should.be.bignumber.equal(new BN(0));
      }

      delegatorTokensBalanceAfter.should.be.bignumber.equal(delegatorTokensBalanceBefore);
      delegatorCoinsBalanceAfter.should.be.bignumber.equal(delegatorCoinsBalanceBefore.sub(weiSpent));
    });

    it('stake movements', async () => {
      await testClaimRewardAfterStakeMovements(
        [5, 15, 25, 35],
        [10, 20, 30]
      );
    });
    it('stake movements', async () => {
      await testClaimRewardAfterStakeMovements(
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        [1, 2, 3, 4, 5, 6, 7, 8, 9]
      );
    });
    it('stake movements', async () => {
      await testClaimRewardAfterStakeMovements(
        [1, 3, 6, 10],
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
      );
    });
    it('stake movements', async () => {
      await testClaimRewardAfterStakeMovements(
        [],
        [1, 2, 3]
      );
    });
    it('stake movements', async () => {
      await testClaimRewardAfterStakeMovements(
        [2],
        [1, 2, 3]
      );
    });

    it('stake increasing', async () => {
      await testClaimRewardAfterStakeIncreasing(
        [5, 15, 25, 35],
        [4, 14, 24, 34]
      );
    });
    it('stake increasing', async () => {
      await testClaimRewardAfterStakeIncreasing(
        [5, 15, 25, 35],
        [10, 20, 30]
      );
    });
    it('stake increasing', async () => {
      await testClaimRewardAfterStakeIncreasing(
        [1, 2, 3, 4, 5, 6],
        [1, 2, 3, 4, 5]
      );
    });
    it('stake increasing', async () => {
      await testClaimRewardAfterStakeIncreasing(
        [1, 3, 6, 10],
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
      );
    });
    it('stake increasing', async () => {
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

    it('random withdrawal', async () => {
      await testClaimRewardRandom(
        [5, 15, 25, 35],
        [4, 14, 24, 34]
      );
    });
    it('random withdrawal', async () => {
      await testClaimRewardRandom(
        [5, 15, 25, 35],
        [10, 20, 30]
      );
    });
    it('random withdrawal', async () => {
      await testClaimRewardRandom(
        [1, 2, 3, 4, 5, 6],
        [1, 2, 3, 4, 5]
      );
    });
    it('random withdrawal', async () => {
      await testClaimRewardRandom(
        [1, 3, 6, 10],
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
      );
    });
    it('random withdrawal', async () => {
      await testClaimRewardRandom(
        [5, 15, 25],
        [5, 15, 25]
      );
    });
    it('random withdrawal', async () => {
      await testClaimRewardRandom(
        [5, 7, 9],
        [6, 8, 10]
      );
    });

    it('reward is got from the first epoch', async () => {
      await testClaimRewardAfterStakeMovements([1], []);
    });

    it('stake is withdrawn forever', async () => {
      const miningAddress = initialValidators[0];
      const stakingAddress = initialStakingAddresses[0];
      const epochPoolReward = new BN(web3.utils.toWei('1', 'ether'));

      (await erc677Token.balanceOf.call(blockRewardHbbft.address)).should.be.bignumber.equal(new BN(0));
      (await web3.eth.getBalance(blockRewardHbbft.address)).should.be.equal('0');

      let stakingEpoch;

      // Emulate snapshotting and rewards for the pool
      stakingEpoch = 9;
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch, miningAddress).should.be.fulfilled;
      await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, epochPoolReward, {value: epochPoolReward}).should.be.fulfilled;
      (await erc677Token.balanceOf.call(blockRewardHbbft.address)).should.be.bignumber.equal(epochPoolReward);
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(epochPoolReward);
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress).should.be.fulfilled;

      // Emulate delegator's stake withdrawal
      stakingEpoch = 10;
      const stakingEpochStartBlock = new BN(120954 * stakingEpoch + 1);
      await stakingHbbft.setStakingEpoch(stakingEpoch).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress(owner).should.be.fulfilled;
      await stakingHbbft.setStakingEpochStartBlock(stakingEpochStartBlock).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
      await setCurrentBlockNumber(stakingEpochStartBlock);
      await stakingHbbft.orderWithdraw(stakingAddress, delegatorMinStake, {from: delegator}).should.be.fulfilled;
      await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, epochPoolReward, {value: epochPoolReward}).should.be.fulfilled;
      (await erc677Token.balanceOf.call(blockRewardHbbft.address)).should.be.bignumber.equal(epochPoolReward.mul(new BN(2)));
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(epochPoolReward.mul(new BN(2)));
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress).should.be.fulfilled;

      // Emulate rewards for the pool
      stakingEpoch = 11;
      await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, epochPoolReward, {value: epochPoolReward}).should.be.fulfilled;
      (await erc677Token.balanceOf.call(blockRewardHbbft.address)).should.be.bignumber.equal(epochPoolReward.mul(new BN(3)));
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(epochPoolReward.mul(new BN(3)));
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress).should.be.fulfilled;

      await stakingHbbft.setStakingEpoch(12).should.be.fulfilled;

      const delegatorRewardExpected = epochPoolReward.mul(new BN(2)).div(new BN(2));

      const rewardAmountsCalculated = await stakingHbbft.getRewardAmount.call([], stakingAddress, delegator);
      rewardAmountsCalculated.tokenRewardSum.should.be.bignumber.equal(delegatorRewardExpected);
      rewardAmountsCalculated.nativeRewardSum.should.be.bignumber.equal(delegatorRewardExpected);

      const delegatorTokensBalanceBefore = await erc677Token.balanceOf.call(delegator);
      const delegatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(delegator));
      let result = await stakingHbbft.claimReward([], stakingAddress, {from: delegator}).should.be.fulfilled;
      const tx = await web3.eth.getTransaction(result.tx);
      const weiSpent = (new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice));
      const delegatorTokensBalanceAfter = await erc677Token.balanceOf.call(delegator);
      const delegatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(delegator));

      result.logs.length.should.be.equal(2);
      result.logs[0].event.should.be.equal("ClaimedReward");
      result.logs[0].args.stakingEpoch.should.be.bignumber.equal(new BN(9));
      result.logs[0].args.tokensAmount.should.be.bignumber.equal(epochPoolReward.div(new BN(2)));
      result.logs[0].args.nativeCoinsAmount.should.be.bignumber.equal(epochPoolReward.div(new BN(2)));
      result.logs[1].event.should.be.equal("ClaimedReward");
      result.logs[1].args.stakingEpoch.should.be.bignumber.equal(new BN(10));
      result.logs[1].args.tokensAmount.should.be.bignumber.equal(epochPoolReward.div(new BN(2)));
      result.logs[1].args.nativeCoinsAmount.should.be.bignumber.equal(epochPoolReward.div(new BN(2)));

      delegatorTokensBalanceAfter.should.be.bignumber.equal(delegatorTokensBalanceBefore.add(delegatorRewardExpected));
      delegatorCoinsBalanceAfter.should.be.bignumber.equal(delegatorCoinsBalanceBefore.add(delegatorRewardExpected).sub(weiSpent));

      result = await stakingHbbft.claimReward([], stakingAddress, {from: stakingAddress}).should.be.fulfilled;
      result.logs.length.should.be.equal(3);
      result.logs[0].args.stakingEpoch.should.be.bignumber.equal(new BN(9));
      result.logs[1].args.stakingEpoch.should.be.bignumber.equal(new BN(10));
      result.logs[2].args.stakingEpoch.should.be.bignumber.equal(new BN(11));
      (await erc677Token.balanceOf.call(blockRewardHbbft.address)).should.be.bignumber.equal(new BN(0));
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(new BN(0));
    });

    it('stake is withdrawn forever', async () => {
      const miningAddress = initialValidators[0];
      const stakingAddress = initialStakingAddresses[0];
      const epochPoolReward = new BN(web3.utils.toWei('1', 'ether'));

      (await erc677Token.balanceOf.call(blockRewardHbbft.address)).should.be.bignumber.equal(new BN(0));
      (await web3.eth.getBalance(blockRewardHbbft.address)).should.be.equal('0');

      let stakingEpoch;

      // Emulate snapshotting and rewards for the pool
      stakingEpoch = 9;
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch, miningAddress).should.be.fulfilled;
      await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, epochPoolReward, {value: epochPoolReward}).should.be.fulfilled;
      (await erc677Token.balanceOf.call(blockRewardHbbft.address)).should.be.bignumber.equal(epochPoolReward);
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(epochPoolReward);
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress).should.be.fulfilled;

      // Emulate delegator's stake withdrawal
      stakingEpoch = 10;
      const stakingEpochStartBlock = new BN(120954 * stakingEpoch + 1);
      await stakingHbbft.setStakingEpoch(stakingEpoch).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress(owner).should.be.fulfilled;
      await stakingHbbft.setStakingEpochStartBlock(stakingEpochStartBlock).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
      await setCurrentBlockNumber(stakingEpochStartBlock);
      await stakingHbbft.orderWithdraw(stakingAddress, delegatorMinStake, {from: delegator}).should.be.fulfilled;
      await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, epochPoolReward, {value: epochPoolReward}).should.be.fulfilled;
      (await erc677Token.balanceOf.call(blockRewardHbbft.address)).should.be.bignumber.equal(epochPoolReward.mul(new BN(2)));
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(epochPoolReward.mul(new BN(2)));
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress).should.be.fulfilled;

      // Emulate rewards for the pool
      stakingEpoch = 11;
      await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, epochPoolReward, {value: epochPoolReward}).should.be.fulfilled;
      (await erc677Token.balanceOf.call(blockRewardHbbft.address)).should.be.bignumber.equal(epochPoolReward.mul(new BN(3)));
      (new BN(await web3.eth.getBalance(blockRewardHbbft.address))).should.be.bignumber.equal(epochPoolReward.mul(new BN(3)));
      await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress).should.be.fulfilled;

      await stakingHbbft.setStakingEpoch(12).should.be.fulfilled;

      const rewardAmountsCalculated = await stakingHbbft.getRewardAmount.call([11], stakingAddress, delegator);
      rewardAmountsCalculated.tokenRewardSum.should.be.bignumber.equal(new BN(0));
      rewardAmountsCalculated.nativeRewardSum.should.be.bignumber.equal(new BN(0));

      const delegatorTokensBalanceBefore = await erc677Token.balanceOf.call(delegator);
      const delegatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(delegator));
      const result = await stakingHbbft.claimReward([11], stakingAddress, {from: delegator}).should.be.fulfilled;
      const tx = await web3.eth.getTransaction(result.tx);
      const weiSpent = (new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice));
      const delegatorTokensBalanceAfter = await erc677Token.balanceOf.call(delegator);
      const delegatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(delegator));

      result.logs.length.should.be.equal(0);
      delegatorTokensBalanceAfter.should.be.bignumber.equal(delegatorTokensBalanceBefore);
      delegatorCoinsBalanceAfter.should.be.bignumber.equal(delegatorCoinsBalanceBefore.sub(weiSpent));
    });

    it('gas consumption for one staking epoch is OK', async () => {
      const stakingEpoch = 2600;

      for (let i = 0; i < initialValidators.length; i++) {
        await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch, initialValidators[i]);
      }

      await stakingHbbft.setStakingEpoch(stakingEpoch).should.be.fulfilled;
      const stakingEpochStartBlock = new BN(120954 * stakingEpoch + 1);
      await stakingHbbft.setValidatorSetAddress(owner).should.be.fulfilled;
      await stakingHbbft.setStakingEpochStartBlock(stakingEpochStartBlock).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
      await setCurrentBlockNumber(stakingEpochStartBlock);

      let result = await validatorSetHbbft.emitInitiateChange().should.be.fulfilled;
      result.logs[0].event.should.be.equal("InitiateChange");
      result.logs[0].args.newSet.should.be.deep.equal(initialValidators);

      const currentBlock = stakingEpochStartBlock.add(new BN(Math.floor(initialValidators.length / 2) + 1));
      await setCurrentBlockNumber(currentBlock);

      (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(new BN(0));
      await callFinalizeChange();
      const validatorSetApplyBlock = await validatorSetHbbft.validatorSetApplyBlock.call();
      validatorSetApplyBlock.should.be.bignumber.equal(currentBlock);
      (await validatorSetHbbft.getValidators.call()).should.be.deep.equal(initialValidators);

      await accrueBridgeFees();

      const stakingEpochEndBlock = stakingEpochStartBlock.add(new BN(120954 - 1));
      await setCurrentBlockNumber(stakingEpochEndBlock);

      const blocksCreated = stakingEpochEndBlock.sub(validatorSetApplyBlock).div(new BN(initialValidators.length));
      blocksCreated.should.be.bignumber.above(new BN(0));
      for (let i = 0; i < initialValidators.length; i++) {
        await blockRewardHbbft.setBlocksCreated(new BN(stakingEpoch), initialValidators[i], blocksCreated).should.be.fulfilled;
      }

      let blockRewardTokensBalanceBefore = await erc677Token.balanceOf.call(blockRewardHbbft.address);
      let blockRewardCoinsBalanceBefore = new BN(await web3.eth.getBalance(blockRewardHbbft.address));
      for (let i = 0; i < initialValidators.length; i++) {
        (await blockRewardHbbft.epochPoolTokenReward.call(stakingEpoch, initialValidators[i])).should.be.bignumber.equal(new BN(0));
        (await blockRewardHbbft.epochPoolNativeReward.call(stakingEpoch, initialValidators[i])).should.be.bignumber.equal(new BN(0));
      }
      await callReward();
      (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(new BN(0));
      let distributedTokensAmount = new BN(0);
      let distributedCoinsAmount = new BN(0);
      for (let i = 0; i < initialValidators.length; i++) {
        const epochPoolTokenReward = await blockRewardHbbft.epochPoolTokenReward.call(stakingEpoch, initialValidators[i]);
        const epochPoolNativeReward = await blockRewardHbbft.epochPoolNativeReward.call(stakingEpoch, initialValidators[i]);
        epochPoolTokenReward.should.be.bignumber.above(new BN(0));
        epochPoolNativeReward.should.be.bignumber.above(new BN(0));
        distributedTokensAmount = distributedTokensAmount.add(epochPoolTokenReward);
        distributedCoinsAmount = distributedCoinsAmount.add(epochPoolNativeReward);
      }
      let blockRewardTokensBalanceAfter = await erc677Token.balanceOf.call(blockRewardHbbft.address);
      let blockRewardCoinsBalanceAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));
      blockRewardTokensBalanceAfter.should.be.bignumber.equal(blockRewardTokensBalanceBefore.add(distributedTokensAmount));
      blockRewardCoinsBalanceAfter.should.be.bignumber.equal(blockRewardCoinsBalanceBefore.add(distributedCoinsAmount));

      // The delegator claims their rewards
      const delegatorTokensBalanceBefore = await erc677Token.balanceOf.call(delegator);
      const delegatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(delegator));

      blockRewardTokensBalanceBefore = await erc677Token.balanceOf.call(blockRewardHbbft.address);
      blockRewardCoinsBalanceBefore = new BN(await web3.eth.getBalance(blockRewardHbbft.address));

      const expectedClaimRewardAmounts = (await stakingHbbft.getRewardAmount.call([stakingEpoch], initialStakingAddresses[0], delegator));

      result = await stakingHbbft.claimReward([stakingEpoch], initialStakingAddresses[0], {from: delegator}).should.be.fulfilled;

      result.logs[0].event.should.be.equal("ClaimedReward");
      result.logs[0].args.fromPoolStakingAddress.should.be.equal(initialStakingAddresses[0]);
      result.logs[0].args.staker.should.be.equal(delegator);
      result.logs[0].args.stakingEpoch.should.be.bignumber.equal(new BN(stakingEpoch));

      const claimedTokensAmount = result.logs[0].args.tokensAmount;
      const claimedCoinsAmount = result.logs[0].args.nativeCoinsAmount;

      expectedClaimRewardAmounts.tokenRewardSum.should.be.bignumber.equal(claimedTokensAmount);
      expectedClaimRewardAmounts.nativeRewardSum.should.be.bignumber.equal(claimedCoinsAmount);

      const tx = await web3.eth.getTransaction(result.tx);
      const weiSpent = (new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice));

      if (!!process.env.SOLIDITY_COVERAGE !== true) {
        result.receipt.gasUsed.should.be.below(1700000);
        // result.receipt.gasUsed.should.be.below(3020000); // for Istanbul
      }

      const delegatorTokensBalanceAfter = await erc677Token.balanceOf.call(delegator);
      const delegatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(delegator));

      blockRewardTokensBalanceAfter = await erc677Token.balanceOf.call(blockRewardHbbft.address);
      blockRewardCoinsBalanceAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));

      delegatorTokensBalanceAfter.should.be.bignumber.equal(delegatorTokensBalanceBefore.add(claimedTokensAmount));
      delegatorCoinsBalanceAfter.should.be.bignumber.equal(delegatorCoinsBalanceBefore.add(claimedCoinsAmount).sub(weiSpent));

      blockRewardTokensBalanceAfter.should.be.bignumber.equal(blockRewardTokensBalanceBefore.sub(claimedTokensAmount));
      blockRewardCoinsBalanceAfter.should.be.bignumber.equal(blockRewardCoinsBalanceBefore.sub(claimedCoinsAmount));
    });

    it('gas consumption for one staking epoch is OK', async () => {
      const maxStakingEpoch = 20;

      maxStakingEpoch.should.be.above(2);

      // Loop of staking epochs
      for (let stakingEpoch = 1; stakingEpoch <= maxStakingEpoch; stakingEpoch++) {
        (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(new BN(stakingEpoch));

        const stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
        stakingEpochStartBlock.should.be.bignumber.equal(new BN(120954 * stakingEpoch + 1));
        await setCurrentBlockNumber(stakingEpochStartBlock);

        const result = await validatorSetHbbft.emitInitiateChange().should.be.fulfilled;
        result.logs[0].event.should.be.equal("InitiateChange");
        result.logs[0].args.newSet.should.be.deep.equal(initialValidators);

        const currentBlock = stakingEpochStartBlock.add(new BN(Math.floor(initialValidators.length / 2) + 1));
        await setCurrentBlockNumber(currentBlock);

        (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(new BN(0));
        await callFinalizeChange();
        const validatorSetApplyBlock = await validatorSetHbbft.validatorSetApplyBlock.call();
        validatorSetApplyBlock.should.be.bignumber.equal(currentBlock);
        (await validatorSetHbbft.getValidators.call()).should.be.deep.equal(initialValidators);

        await accrueBridgeFees();

        const stakingEpochEndBlock = stakingEpochStartBlock.add(new BN(120954 - 1));
        await setCurrentBlockNumber(stakingEpochEndBlock);

        const blocksCreated = stakingEpochEndBlock.sub(validatorSetApplyBlock).div(new BN(initialValidators.length));
        blocksCreated.should.be.bignumber.above(new BN(0));
        for (let i = 0; i < initialValidators.length; i++) {
          await blockRewardHbbft.setBlocksCreated(new BN(stakingEpoch), initialValidators[i], blocksCreated).should.be.fulfilled;
        }

        const blockRewardTokensBalanceBefore = await erc677Token.balanceOf.call(blockRewardHbbft.address);
        const blockRewardCoinsBalanceBefore = new BN(await web3.eth.getBalance(blockRewardHbbft.address));
        for (let i = 0; i < initialValidators.length; i++) {
          (await blockRewardHbbft.epochPoolTokenReward.call(stakingEpoch, initialValidators[i])).should.be.bignumber.equal(new BN(0));
          (await blockRewardHbbft.epochPoolNativeReward.call(stakingEpoch, initialValidators[i])).should.be.bignumber.equal(new BN(0));
        }
        await callReward();
        let distributedTokensAmount = new BN(0);
        let distributedCoinsAmount = new BN(0);
        for (let i = 0; i < initialValidators.length; i++) {
          const epochPoolTokenReward = await blockRewardHbbft.epochPoolTokenReward.call(stakingEpoch, initialValidators[i]);
          const epochPoolNativeReward = await blockRewardHbbft.epochPoolNativeReward.call(stakingEpoch, initialValidators[i]);
          epochPoolTokenReward.should.be.bignumber.above(new BN(0));
          epochPoolNativeReward.should.be.bignumber.above(new BN(0));
          distributedTokensAmount = distributedTokensAmount.add(epochPoolTokenReward);
          distributedCoinsAmount = distributedCoinsAmount.add(epochPoolNativeReward);
        }
        const blockRewardTokensBalanceAfter = await erc677Token.balanceOf.call(blockRewardHbbft.address);
        const blockRewardCoinsBalanceAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));
        blockRewardTokensBalanceAfter.should.be.bignumber.equal(blockRewardTokensBalanceBefore.add(distributedTokensAmount));
        blockRewardCoinsBalanceAfter.should.be.bignumber.equal(blockRewardCoinsBalanceBefore.add(distributedCoinsAmount));
      }

      // The delegator claims their rewards
      let initialGasConsumption = new BN(0);
      let startGasConsumption = new BN(0);
      let endGasConsumption = new BN(0);
      let blockRewardTokensBalanceTotalBefore = await erc677Token.balanceOf.call(blockRewardHbbft.address);
      let blockRewardCoinsBalanceTotalBefore = new BN(await web3.eth.getBalance(blockRewardHbbft.address));

      let tokensDelegatorGotForAllEpochs = new BN(0);
      let coinsDelegatorGotForAllEpochs = new BN(0);
      for (let stakingEpoch = 1; stakingEpoch <= maxStakingEpoch; stakingEpoch++) {
        const delegatorTokensBalanceBefore = await erc677Token.balanceOf.call(delegator);
        const delegatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(delegator));

        const blockRewardTokensBalanceBefore = await erc677Token.balanceOf.call(blockRewardHbbft.address);
        const blockRewardCoinsBalanceBefore = new BN(await web3.eth.getBalance(blockRewardHbbft.address));

        const expectedClaimRewardAmounts = (await stakingHbbft.getRewardAmount.call([stakingEpoch], initialStakingAddresses[0], delegator));

        let result = await stakingHbbft.claimReward([stakingEpoch], initialStakingAddresses[0], {from: delegator}).should.be.fulfilled;
        result.logs[0].event.should.be.equal("ClaimedReward");
        result.logs[0].args.fromPoolStakingAddress.should.be.equal(initialStakingAddresses[0]);
        result.logs[0].args.staker.should.be.equal(delegator);
        result.logs[0].args.stakingEpoch.should.be.bignumber.equal(new BN(stakingEpoch));

        const claimedTokensAmount = result.logs[0].args.tokensAmount;
        const claimedCoinsAmount = result.logs[0].args.nativeCoinsAmount;

        expectedClaimRewardAmounts.tokenRewardSum.should.be.bignumber.equal(claimedTokensAmount);
        expectedClaimRewardAmounts.nativeRewardSum.should.be.bignumber.equal(claimedCoinsAmount);

        const tx = await web3.eth.getTransaction(result.tx);
        const weiSpent = (new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice));

        if (stakingEpoch == 1) {
          initialGasConsumption = new BN(result.receipt.gasUsed);
        } else if (stakingEpoch == 2) {
          startGasConsumption = new BN(result.receipt.gasUsed);
        } else if (stakingEpoch == maxStakingEpoch) {
          endGasConsumption = new BN(result.receipt.gasUsed);
        }

        const delegatorTokensBalanceAfter = await erc677Token.balanceOf.call(delegator);
        const delegatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(delegator));

        const blockRewardTokensBalanceAfter = await erc677Token.balanceOf.call(blockRewardHbbft.address);
        const blockRewardCoinsBalanceAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));

        delegatorTokensBalanceAfter.should.be.bignumber.equal(delegatorTokensBalanceBefore.add(claimedTokensAmount));
        delegatorCoinsBalanceAfter.should.be.bignumber.equal(delegatorCoinsBalanceBefore.add(claimedCoinsAmount).sub(weiSpent));

        blockRewardTokensBalanceAfter.should.be.bignumber.equal(blockRewardTokensBalanceBefore.sub(claimedTokensAmount));
        blockRewardCoinsBalanceAfter.should.be.bignumber.equal(blockRewardCoinsBalanceBefore.sub(claimedCoinsAmount));

        tokensDelegatorGotForAllEpochs = tokensDelegatorGotForAllEpochs.add(claimedTokensAmount);
        coinsDelegatorGotForAllEpochs = coinsDelegatorGotForAllEpochs.add(claimedCoinsAmount);

        // console.log(`stakingEpoch = ${stakingEpoch}, gasUsed = ${result.receipt.gasUsed}, cumulativeGasUsed = ${result.receipt.cumulativeGasUsed}`);
      }

      if (!!process.env.SOLIDITY_COVERAGE !== true) {
        const perEpochGasConsumption = endGasConsumption.sub(startGasConsumption).div(new BN(maxStakingEpoch - 2));
        perEpochGasConsumption.should.be.bignumber.equal(new BN(509));
        // perEpochGasConsumption.should.be.bignumber.equal(new BN(1109)); // for Istanbul

        // Check gas consumption for the case when the delegator didn't touch their
        // stake for 50 years (2600 staking epochs)
        const maxGasConsumption = initialGasConsumption.sub(perEpochGasConsumption).add(perEpochGasConsumption.mul(new BN(2600)));
        maxGasConsumption.should.be.bignumber.below(new BN(1700000));
        // maxGasConsumption.should.be.bignumber.below(new BN(3020000)); // for Istanbul
      }

      let blockRewardTokensBalanceTotalAfter = await erc677Token.balanceOf.call(blockRewardHbbft.address);
      let blockRewardCoinsBalanceTotalAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));

      blockRewardTokensBalanceTotalAfter.should.be.bignumber.equal(blockRewardTokensBalanceTotalBefore.sub(tokensDelegatorGotForAllEpochs));
      blockRewardCoinsBalanceTotalAfter.should.be.bignumber.equal(blockRewardCoinsBalanceTotalBefore.sub(coinsDelegatorGotForAllEpochs));

      // The validators claim their rewards
      let tokensValidatorsGotForAllEpochs = new BN(0);
      let coinsValidatorsGotForAllEpochs = new BN(0);
      for (let v = 0; v < initialStakingAddresses.length; v++) {
        for (let stakingEpoch = 1; stakingEpoch <= maxStakingEpoch; stakingEpoch++) {
          const validator = initialStakingAddresses[v];
          const validatorTokensBalanceBefore = await erc677Token.balanceOf.call(validator);
          const validatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(validator));

          const blockRewardTokensBalanceBefore = await erc677Token.balanceOf.call(blockRewardHbbft.address);
          const blockRewardCoinsBalanceBefore = new BN(await web3.eth.getBalance(blockRewardHbbft.address));

          const expectedClaimRewardAmounts = (await stakingHbbft.getRewardAmount.call([stakingEpoch], validator, validator));

          let result = await stakingHbbft.claimReward([stakingEpoch], validator, {from: validator}).should.be.fulfilled;
          result.logs[0].event.should.be.equal("ClaimedReward");
          result.logs[0].args.fromPoolStakingAddress.should.be.equal(validator);
          result.logs[0].args.staker.should.be.equal(validator);
          result.logs[0].args.stakingEpoch.should.be.bignumber.equal(new BN(stakingEpoch));

          const claimedTokensAmount = result.logs[0].args.tokensAmount;
          const claimedCoinsAmount = result.logs[0].args.nativeCoinsAmount;

          expectedClaimRewardAmounts.tokenRewardSum.should.be.bignumber.equal(claimedTokensAmount);
          expectedClaimRewardAmounts.nativeRewardSum.should.be.bignumber.equal(claimedCoinsAmount);

          const tx = await web3.eth.getTransaction(result.tx);
          const weiSpent = (new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice));

          const validatorTokensBalanceAfter = await erc677Token.balanceOf.call(validator);
          const validatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(validator));

          const blockRewardTokensBalanceAfter = await erc677Token.balanceOf.call(blockRewardHbbft.address);
          const blockRewardCoinsBalanceAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));

          validatorTokensBalanceAfter.should.be.bignumber.equal(validatorTokensBalanceBefore.add(claimedTokensAmount));
          validatorCoinsBalanceAfter.should.be.bignumber.equal(validatorCoinsBalanceBefore.add(claimedCoinsAmount).sub(weiSpent));

          blockRewardTokensBalanceAfter.should.be.bignumber.equal(blockRewardTokensBalanceBefore.sub(claimedTokensAmount));
          blockRewardCoinsBalanceAfter.should.be.bignumber.equal(blockRewardCoinsBalanceBefore.sub(claimedCoinsAmount));

          tokensValidatorsGotForAllEpochs = tokensValidatorsGotForAllEpochs.add(claimedTokensAmount);
          coinsValidatorsGotForAllEpochs = coinsValidatorsGotForAllEpochs.add(claimedCoinsAmount);
        }
      }

      blockRewardTokensBalanceTotalAfter = await erc677Token.balanceOf.call(blockRewardHbbft.address);
      blockRewardCoinsBalanceTotalAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));

      blockRewardTokensBalanceTotalAfter.should.be.bignumber.equal(blockRewardTokensBalanceTotalBefore.sub(tokensDelegatorGotForAllEpochs).sub(tokensValidatorsGotForAllEpochs));
      blockRewardCoinsBalanceTotalAfter.should.be.bignumber.equal(blockRewardCoinsBalanceTotalBefore.sub(coinsDelegatorGotForAllEpochs).sub(coinsValidatorsGotForAllEpochs));

      blockRewardTokensBalanceTotalAfter.should.be.bignumber.gte(new BN(0));
      blockRewardCoinsBalanceTotalAfter.should.be.bignumber.gte(new BN(0));
    });

    it('gas consumption for 52 staking epochs (1 continuous year) is OK', async () => {
      const maxStakingEpoch = 52;

      // Loop of staking epochs
      for (let stakingEpoch = 1; stakingEpoch <= maxStakingEpoch; stakingEpoch++) {
        (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(new BN(stakingEpoch));

        const stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
        stakingEpochStartBlock.should.be.bignumber.equal(new BN(120954 * stakingEpoch + 1));
        await setCurrentBlockNumber(stakingEpochStartBlock);

        const result = await validatorSetHbbft.emitInitiateChange().should.be.fulfilled;
        result.logs[0].event.should.be.equal("InitiateChange");
        result.logs[0].args.newSet.should.be.deep.equal(initialValidators);

        const currentBlock = stakingEpochStartBlock.add(new BN(Math.floor(initialValidators.length / 2) + 1));
        await setCurrentBlockNumber(currentBlock);

        (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(new BN(0));
        await callFinalizeChange();
        const validatorSetApplyBlock = await validatorSetHbbft.validatorSetApplyBlock.call();
        validatorSetApplyBlock.should.be.bignumber.equal(currentBlock);
        (await validatorSetHbbft.getValidators.call()).should.be.deep.equal(initialValidators);

        await accrueBridgeFees();

        const stakingEpochEndBlock = stakingEpochStartBlock.add(new BN(120954 - 1));
        await setCurrentBlockNumber(stakingEpochEndBlock);

        const blocksCreated = stakingEpochEndBlock.sub(validatorSetApplyBlock).div(new BN(initialValidators.length));
        blocksCreated.should.be.bignumber.above(new BN(0));
        for (let i = 0; i < initialValidators.length; i++) {
          await blockRewardHbbft.setBlocksCreated(new BN(stakingEpoch), initialValidators[i], blocksCreated).should.be.fulfilled;
        }

        const blockRewardTokensBalanceBefore = await erc677Token.balanceOf.call(blockRewardHbbft.address);
        const blockRewardCoinsBalanceBefore = new BN(await web3.eth.getBalance(blockRewardHbbft.address));
        for (let i = 0; i < initialValidators.length; i++) {
          (await blockRewardHbbft.epochPoolTokenReward.call(stakingEpoch, initialValidators[i])).should.be.bignumber.equal(new BN(0));
          (await blockRewardHbbft.epochPoolNativeReward.call(stakingEpoch, initialValidators[i])).should.be.bignumber.equal(new BN(0));
        }
        await callReward();
        let distributedTokensAmount = new BN(0);
        let distributedCoinsAmount = new BN(0);
        for (let i = 0; i < initialValidators.length; i++) {
          const epochPoolTokenReward = await blockRewardHbbft.epochPoolTokenReward.call(stakingEpoch, initialValidators[i]);
          const epochPoolNativeReward = await blockRewardHbbft.epochPoolNativeReward.call(stakingEpoch, initialValidators[i]);
          epochPoolTokenReward.should.be.bignumber.above(new BN(0));
          epochPoolNativeReward.should.be.bignumber.above(new BN(0));
          distributedTokensAmount = distributedTokensAmount.add(epochPoolTokenReward);
          distributedCoinsAmount = distributedCoinsAmount.add(epochPoolNativeReward);
        }
        const blockRewardTokensBalanceAfter = await erc677Token.balanceOf.call(blockRewardHbbft.address);
        const blockRewardCoinsBalanceAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));
        blockRewardTokensBalanceAfter.should.be.bignumber.equal(blockRewardTokensBalanceBefore.add(distributedTokensAmount));
        blockRewardCoinsBalanceAfter.should.be.bignumber.equal(blockRewardCoinsBalanceBefore.add(distributedCoinsAmount));
      }

      // The delegator claims their rewards
      const delegatorTokensBalanceBefore = await erc677Token.balanceOf.call(delegator);
      const delegatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(delegator));

      const blockRewardTokensBalanceBefore = await erc677Token.balanceOf.call(blockRewardHbbft.address);
      const blockRewardCoinsBalanceBefore = new BN(await web3.eth.getBalance(blockRewardHbbft.address));
      const blockRewardTokensBalanceTotalBefore = blockRewardTokensBalanceBefore;
      const blockRewardCoinsBalanceTotalBefore = blockRewardCoinsBalanceBefore;

      const expectedClaimRewardAmounts = (await stakingHbbft.getRewardAmount.call([], initialStakingAddresses[0], delegator));

      const result = await stakingHbbft.claimReward([], initialStakingAddresses[0], {from: delegator}).should.be.fulfilled;

      let tokensDelegatorGotForAllEpochs = new BN(0);
      let coinsDelegatorGotForAllEpochs = new BN(0);
      for (let i = 0; i < maxStakingEpoch; i++) {
        result.logs[i].event.should.be.equal("ClaimedReward");
        result.logs[i].args.fromPoolStakingAddress.should.be.equal(initialStakingAddresses[0]);
        result.logs[i].args.staker.should.be.equal(delegator);
        result.logs[i].args.stakingEpoch.should.be.bignumber.equal(new BN(i + 1));
        tokensDelegatorGotForAllEpochs = tokensDelegatorGotForAllEpochs.add(result.logs[i].args.tokensAmount);
        coinsDelegatorGotForAllEpochs = coinsDelegatorGotForAllEpochs.add(result.logs[i].args.nativeCoinsAmount);
      }

      expectedClaimRewardAmounts.tokenRewardSum.should.be.bignumber.equal(tokensDelegatorGotForAllEpochs);
      expectedClaimRewardAmounts.nativeRewardSum.should.be.bignumber.equal(coinsDelegatorGotForAllEpochs);

      const tx = await web3.eth.getTransaction(result.tx);
      const weiSpent = (new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice));

      // console.log(`gasUsed = ${result.receipt.gasUsed}, cumulativeGasUsed = ${result.receipt.cumulativeGasUsed}`);

      if (!!process.env.SOLIDITY_COVERAGE !== true) {
        result.receipt.gasUsed.should.be.below(1710000);
        // result.receipt.gasUsed.should.be.below(2100000); // for Istanbul
      }

      const delegatorTokensBalanceAfter = await erc677Token.balanceOf.call(delegator);
      const delegatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(delegator));

      const blockRewardTokensBalanceAfter = await erc677Token.balanceOf.call(blockRewardHbbft.address);
      const blockRewardCoinsBalanceAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));

      tokensDelegatorGotForAllEpochs.should.be.bignumber.gte(new BN(0));
      coinsDelegatorGotForAllEpochs.should.be.bignumber.gte(new BN(0));

      delegatorTokensBalanceAfter.should.be.bignumber.equal(delegatorTokensBalanceBefore.add(tokensDelegatorGotForAllEpochs));
      delegatorCoinsBalanceAfter.should.be.bignumber.equal(delegatorCoinsBalanceBefore.add(coinsDelegatorGotForAllEpochs).sub(weiSpent));

      blockRewardTokensBalanceAfter.should.be.bignumber.equal(blockRewardTokensBalanceBefore.sub(tokensDelegatorGotForAllEpochs));
      blockRewardCoinsBalanceAfter.should.be.bignumber.equal(blockRewardCoinsBalanceBefore.sub(coinsDelegatorGotForAllEpochs));

      // The validators claim their rewards
      let tokensValidatorsGotForAllEpochs = new BN(0);
      let coinsValidatorsGotForAllEpochs = new BN(0);
      for (let v = 0; v < initialStakingAddresses.length; v++) {
        const validator = initialStakingAddresses[v];
        const validatorTokensBalanceBefore = await erc677Token.balanceOf.call(validator);
        const validatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(validator));

        const blockRewardTokensBalanceBefore = await erc677Token.balanceOf.call(blockRewardHbbft.address);
        const blockRewardCoinsBalanceBefore = new BN(await web3.eth.getBalance(blockRewardHbbft.address));

        const expectedClaimRewardAmounts = (await stakingHbbft.getRewardAmount.call([], validator, validator));

        const result = await stakingHbbft.claimReward([], validator, {from: validator}).should.be.fulfilled;

        let claimedTokensAmount = new BN(0);
        let claimedCoinsAmount = new BN(0);
        for (let i = 0; i < maxStakingEpoch; i++) {
          result.logs[i].event.should.be.equal("ClaimedReward");
          result.logs[i].args.fromPoolStakingAddress.should.be.equal(validator);
          result.logs[i].args.staker.should.be.equal(validator);
          result.logs[i].args.stakingEpoch.should.be.bignumber.equal(new BN(i + 1));
          claimedTokensAmount = claimedTokensAmount.add(result.logs[i].args.tokensAmount);
          claimedCoinsAmount = claimedCoinsAmount.add(result.logs[i].args.nativeCoinsAmount);
        }

        expectedClaimRewardAmounts.tokenRewardSum.should.be.bignumber.equal(claimedTokensAmount);
        expectedClaimRewardAmounts.nativeRewardSum.should.be.bignumber.equal(claimedCoinsAmount);

        const tx = await web3.eth.getTransaction(result.tx);
        const weiSpent = (new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice));

        const validatorTokensBalanceAfter = await erc677Token.balanceOf.call(validator);
        const validatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(validator));

        const blockRewardTokensBalanceAfter = await erc677Token.balanceOf.call(blockRewardHbbft.address);
        const blockRewardCoinsBalanceAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));

        claimedTokensAmount.should.be.bignumber.gte(new BN(0));
        claimedCoinsAmount.should.be.bignumber.gte(new BN(0));

        validatorTokensBalanceAfter.should.be.bignumber.equal(validatorTokensBalanceBefore.add(claimedTokensAmount));
        validatorCoinsBalanceAfter.should.be.bignumber.equal(validatorCoinsBalanceBefore.add(claimedCoinsAmount).sub(weiSpent));

        blockRewardTokensBalanceAfter.should.be.bignumber.equal(blockRewardTokensBalanceBefore.sub(claimedTokensAmount));
        blockRewardCoinsBalanceAfter.should.be.bignumber.equal(blockRewardCoinsBalanceBefore.sub(claimedCoinsAmount));

        tokensValidatorsGotForAllEpochs = tokensValidatorsGotForAllEpochs.add(claimedTokensAmount);
        coinsValidatorsGotForAllEpochs = coinsValidatorsGotForAllEpochs.add(claimedCoinsAmount);
      }

      const blockRewardTokensBalanceTotalAfter = await erc677Token.balanceOf.call(blockRewardHbbft.address);
      const blockRewardCoinsBalanceTotalAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));

      blockRewardTokensBalanceTotalAfter.should.be.bignumber.equal(blockRewardTokensBalanceTotalBefore.sub(tokensDelegatorGotForAllEpochs).sub(tokensValidatorsGotForAllEpochs));
      blockRewardCoinsBalanceTotalAfter.should.be.bignumber.equal(blockRewardCoinsBalanceTotalBefore.sub(coinsDelegatorGotForAllEpochs).sub(coinsValidatorsGotForAllEpochs));

      blockRewardTokensBalanceTotalAfter.should.be.bignumber.gte(new BN(0));
      blockRewardCoinsBalanceTotalAfter.should.be.bignumber.gte(new BN(0));
    });

    it('gas consumption for 52 staking epochs (10 years including gaps) is OK', async () => {
      const maxStakingEpochs = 52;
      const gapSize = 10;

      // Loop of staking epochs
      for (let s = 0; s < maxStakingEpochs; s++) {
        const stakingEpoch = (await stakingHbbft.stakingEpoch.call()).toNumber();

        const stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock.call();
        stakingEpochStartBlock.should.be.bignumber.equal(new BN(120954 * stakingEpoch + 1));
        await setCurrentBlockNumber(stakingEpochStartBlock);

        const result = await validatorSetHbbft.emitInitiateChange().should.be.fulfilled;
        result.logs[0].event.should.be.equal("InitiateChange");
        result.logs[0].args.newSet.should.be.deep.equal(initialValidators);

        const currentBlock = stakingEpochStartBlock.add(new BN(Math.floor(initialValidators.length / 2) + 1));
        await setCurrentBlockNumber(currentBlock);

        (await validatorSetHbbft.validatorSetApplyBlock.call()).should.be.bignumber.equal(new BN(0));
        await callFinalizeChange();
        const validatorSetApplyBlock = await validatorSetHbbft.validatorSetApplyBlock.call();
        validatorSetApplyBlock.should.be.bignumber.equal(currentBlock);
        (await validatorSetHbbft.getValidators.call()).should.be.deep.equal(initialValidators);

        await accrueBridgeFees();

        const stakingEpochEndBlock = stakingEpochStartBlock.add(new BN(120954 - 1));
        await setCurrentBlockNumber(stakingEpochEndBlock);

        const blocksCreated = stakingEpochEndBlock.sub(validatorSetApplyBlock).div(new BN(initialValidators.length));
        blocksCreated.should.be.bignumber.above(new BN(0));
        for (let i = 0; i < initialValidators.length; i++) {
          await blockRewardHbbft.setBlocksCreated(new BN(stakingEpoch), initialValidators[i], blocksCreated).should.be.fulfilled;
        }

        const blockRewardTokensBalanceBefore = await erc677Token.balanceOf.call(blockRewardHbbft.address);
        const blockRewardCoinsBalanceBefore = new BN(await web3.eth.getBalance(blockRewardHbbft.address));
        for (let i = 0; i < initialValidators.length; i++) {
          (await blockRewardHbbft.epochPoolTokenReward.call(stakingEpoch, initialValidators[i])).should.be.bignumber.equal(new BN(0));
          (await blockRewardHbbft.epochPoolNativeReward.call(stakingEpoch, initialValidators[i])).should.be.bignumber.equal(new BN(0));
        }
        await callReward();
        let distributedTokensAmount = new BN(0);
        let distributedCoinsAmount = new BN(0);
        for (let i = 0; i < initialValidators.length; i++) {
          const epochPoolTokenReward = await blockRewardHbbft.epochPoolTokenReward.call(stakingEpoch, initialValidators[i]);
          const epochPoolNativeReward = await blockRewardHbbft.epochPoolNativeReward.call(stakingEpoch, initialValidators[i]);
          epochPoolTokenReward.should.be.bignumber.above(new BN(0));
          epochPoolNativeReward.should.be.bignumber.above(new BN(0));
          distributedTokensAmount = distributedTokensAmount.add(epochPoolTokenReward);
          distributedCoinsAmount = distributedCoinsAmount.add(epochPoolNativeReward);
        }
        const blockRewardTokensBalanceAfter = await erc677Token.balanceOf.call(blockRewardHbbft.address);
        const blockRewardCoinsBalanceAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));
        blockRewardTokensBalanceAfter.should.be.bignumber.equal(blockRewardTokensBalanceBefore.add(distributedTokensAmount));
        blockRewardCoinsBalanceAfter.should.be.bignumber.equal(blockRewardCoinsBalanceBefore.add(distributedCoinsAmount));

        const nextStakingEpoch = stakingEpoch + gapSize; // jump through a few epochs
        await stakingHbbft.setStakingEpoch(nextStakingEpoch).should.be.fulfilled;
        await stakingHbbft.setValidatorSetAddress(owner).should.be.fulfilled;
        await stakingHbbft.setStakingEpochStartBlock(120954 * nextStakingEpoch + 1).should.be.fulfilled;
        await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
        for (let i = 0; i < initialValidators.length; i++) {
          await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, nextStakingEpoch, initialValidators[i]);
        }
      }

      const epochsPoolGotRewardFor = await blockRewardHbbft.epochsPoolGotRewardFor.call(initialValidators[0]);

      // The delegator claims their rewards
      const delegatorTokensBalanceBefore = await erc677Token.balanceOf.call(delegator);
      const delegatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(delegator));

      const blockRewardTokensBalanceBefore = await erc677Token.balanceOf.call(blockRewardHbbft.address);
      const blockRewardCoinsBalanceBefore = new BN(await web3.eth.getBalance(blockRewardHbbft.address));
      const blockRewardTokensBalanceTotalBefore = blockRewardTokensBalanceBefore;
      const blockRewardCoinsBalanceTotalBefore = blockRewardCoinsBalanceBefore;

      const expectedClaimRewardAmounts = (await stakingHbbft.getRewardAmount.call([], initialStakingAddresses[0], delegator));

      const result = await stakingHbbft.claimReward([], initialStakingAddresses[0], {from: delegator}).should.be.fulfilled;

      let tokensDelegatorGotForAllEpochs = new BN(0);
      let coinsDelegatorGotForAllEpochs = new BN(0);
      for (let i = 0; i < maxStakingEpochs; i++) {
        result.logs[i].event.should.be.equal("ClaimedReward");
        result.logs[i].args.fromPoolStakingAddress.should.be.equal(initialStakingAddresses[0]);
        result.logs[i].args.staker.should.be.equal(delegator);
        result.logs[i].args.stakingEpoch.should.be.bignumber.equal(epochsPoolGotRewardFor[i]);
        tokensDelegatorGotForAllEpochs = tokensDelegatorGotForAllEpochs.add(result.logs[i].args.tokensAmount);
        coinsDelegatorGotForAllEpochs = coinsDelegatorGotForAllEpochs.add(result.logs[i].args.nativeCoinsAmount);
      }

      expectedClaimRewardAmounts.tokenRewardSum.should.be.bignumber.equal(tokensDelegatorGotForAllEpochs);
      expectedClaimRewardAmounts.nativeRewardSum.should.be.bignumber.equal(coinsDelegatorGotForAllEpochs);

      const tx = await web3.eth.getTransaction(result.tx);
      const weiSpent = (new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice));

      // console.log(`gasUsed = ${result.receipt.gasUsed}, cumulativeGasUsed = ${result.receipt.cumulativeGasUsed}`);

      if (!!process.env.SOLIDITY_COVERAGE !== true) {
        result.receipt.gasUsed.should.be.below(2000000);
        // result.receipt.gasUsed.should.be.below(2610000); // for Istanbul
      }

      const delegatorTokensBalanceAfter = await erc677Token.balanceOf.call(delegator);
      const delegatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(delegator));

      const blockRewardTokensBalanceAfter = await erc677Token.balanceOf.call(blockRewardHbbft.address);
      const blockRewardCoinsBalanceAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));

      tokensDelegatorGotForAllEpochs.should.be.bignumber.gte(new BN(0));
      coinsDelegatorGotForAllEpochs.should.be.bignumber.gte(new BN(0));

      delegatorTokensBalanceAfter.should.be.bignumber.equal(delegatorTokensBalanceBefore.add(tokensDelegatorGotForAllEpochs));
      delegatorCoinsBalanceAfter.should.be.bignumber.equal(delegatorCoinsBalanceBefore.add(coinsDelegatorGotForAllEpochs).sub(weiSpent));

      blockRewardTokensBalanceAfter.should.be.bignumber.equal(blockRewardTokensBalanceBefore.sub(tokensDelegatorGotForAllEpochs));
      blockRewardCoinsBalanceAfter.should.be.bignumber.equal(blockRewardCoinsBalanceBefore.sub(coinsDelegatorGotForAllEpochs));

      // The validators claim their rewards
      let tokensValidatorsGotForAllEpochs = new BN(0);
      let coinsValidatorsGotForAllEpochs = new BN(0);
      for (let v = 0; v < initialStakingAddresses.length; v++) {
        const validator = initialStakingAddresses[v];
        const validatorTokensBalanceBefore = await erc677Token.balanceOf.call(validator);
        const validatorCoinsBalanceBefore = new BN(await web3.eth.getBalance(validator));

        const blockRewardTokensBalanceBefore = await erc677Token.balanceOf.call(blockRewardHbbft.address);
        const blockRewardCoinsBalanceBefore = new BN(await web3.eth.getBalance(blockRewardHbbft.address));

        const expectedClaimRewardAmounts = (await stakingHbbft.getRewardAmount.call([], validator, validator));

        const result = await stakingHbbft.claimReward([], validator, {from: validator}).should.be.fulfilled;

        let claimedTokensAmount = new BN(0);
        let claimedCoinsAmount = new BN(0);
        for (let i = 0; i < maxStakingEpochs; i++) {
          result.logs[i].event.should.be.equal("ClaimedReward");
          result.logs[i].args.fromPoolStakingAddress.should.be.equal(validator);
          result.logs[i].args.staker.should.be.equal(validator);
          result.logs[i].args.stakingEpoch.should.be.bignumber.equal(epochsPoolGotRewardFor[i]);
          claimedTokensAmount = claimedTokensAmount.add(result.logs[i].args.tokensAmount);
          claimedCoinsAmount = claimedCoinsAmount.add(result.logs[i].args.nativeCoinsAmount);
        }

        expectedClaimRewardAmounts.tokenRewardSum.should.be.bignumber.equal(claimedTokensAmount);
        expectedClaimRewardAmounts.nativeRewardSum.should.be.bignumber.equal(claimedCoinsAmount);

        const tx = await web3.eth.getTransaction(result.tx);
        const weiSpent = (new BN(result.receipt.gasUsed)).mul(new BN(tx.gasPrice));

        const validatorTokensBalanceAfter = await erc677Token.balanceOf.call(validator);
        const validatorCoinsBalanceAfter = new BN(await web3.eth.getBalance(validator));

        const blockRewardTokensBalanceAfter = await erc677Token.balanceOf.call(blockRewardHbbft.address);
        const blockRewardCoinsBalanceAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));

        claimedTokensAmount.should.be.bignumber.gte(new BN(0));
        claimedCoinsAmount.should.be.bignumber.gte(new BN(0));

        validatorTokensBalanceAfter.should.be.bignumber.equal(validatorTokensBalanceBefore.add(claimedTokensAmount));
        validatorCoinsBalanceAfter.should.be.bignumber.equal(validatorCoinsBalanceBefore.add(claimedCoinsAmount).sub(weiSpent));

        blockRewardTokensBalanceAfter.should.be.bignumber.equal(blockRewardTokensBalanceBefore.sub(claimedTokensAmount));
        blockRewardCoinsBalanceAfter.should.be.bignumber.equal(blockRewardCoinsBalanceBefore.sub(claimedCoinsAmount));

        tokensValidatorsGotForAllEpochs = tokensValidatorsGotForAllEpochs.add(claimedTokensAmount);
        coinsValidatorsGotForAllEpochs = coinsValidatorsGotForAllEpochs.add(claimedCoinsAmount);
      }

      const blockRewardTokensBalanceTotalAfter = await erc677Token.balanceOf.call(blockRewardHbbft.address);
      const blockRewardCoinsBalanceTotalAfter = new BN(await web3.eth.getBalance(blockRewardHbbft.address));

      blockRewardTokensBalanceTotalAfter.should.be.bignumber.equal(blockRewardTokensBalanceTotalBefore.sub(tokensDelegatorGotForAllEpochs).sub(tokensValidatorsGotForAllEpochs));
      blockRewardCoinsBalanceTotalAfter.should.be.bignumber.equal(blockRewardCoinsBalanceTotalBefore.sub(coinsDelegatorGotForAllEpochs).sub(coinsValidatorsGotForAllEpochs));

      blockRewardTokensBalanceTotalAfter.should.be.bignumber.gte(new BN(0));
      blockRewardCoinsBalanceTotalAfter.should.be.bignumber.gte(new BN(0));
    });
  });

  describe('clearUnremovableValidator()', async () => {
    beforeEach(async () => {
      // Deploy ValidatorSet contract
      validatorSetHbbft = await ValidatorSetHbbft.new();
      validatorSetHbbft = await AdminUpgradeabilityProxy.new(validatorSetHbbft.address, owner, []);
      validatorSetHbbft = await ValidatorSetHbbft.at(validatorSetHbbft.address);

      // Initialize ValidatorSet
      await validatorSetHbbft.initialize(
        blockRewardHbbft.address, // _blockRewardContract
        '0x3000000000000000000000000000000000000001', // _randomContract
        stakingHbbft.address, // _stakingContract
        initialValidators, // _initialMiningAddresses
        initialStakingAddresses, // _initialStakingAddresses
        true // _firstValidatorIsUnremovable
      ).should.be.fulfilled;

      // Initialize StakingHbbft
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        web3.utils.toWei('1', 'ether'), // _delegatorMinStake
        web3.utils.toWei('1', 'ether'), // _candidateMinStake
        120954, // _stakingEpochDuration
        0, // _stakingEpochStartBlock
        4320, // _stakeWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.fulfilled;
    });

    it('should add validator pool to the poolsToBeElected list', async () => {
      // Deploy ERC677 contract
      const erc677Token = await ERC677BridgeTokenRewardable.new("STAKE", "STAKE", 18, {from: owner});

      // Mint some balance for the non-removable validator (imagine that the validator got 2 STAKE_UNITs from a bridge)
      const stakeUnit = new BN(web3.utils.toWei('1', 'ether'));
      const mintAmount = stakeUnit.mul(new BN(2));
      await erc677Token.mint(initialStakingAddresses[0], mintAmount, {from: owner}).should.be.fulfilled;
      mintAmount.should.be.bignumber.equal(await erc677Token.balanceOf.call(initialStakingAddresses[0]));

      // Pass Staking contract address to ERC677 contract
      await erc677Token.setStakingContract(stakingHbbft.address, {from: owner}).should.be.fulfilled;
      stakingHbbft.address.should.be.equal(await erc677Token.stakingContract.call());

      // Pass ERC677 contract address to Staking contract
      await stakingHbbft.setErc677TokenContract(erc677Token.address, {from: owner}).should.be.fulfilled;
      erc677Token.address.should.be.equal(await stakingHbbft.erc677TokenContract.call());

      // Emulate block number
      await stakingHbbft.setCurrentBlockNumber(100).should.be.fulfilled;
      await validatorSetHbbft.setCurrentBlockNumber(100).should.be.fulfilled;

      // Place a stake for itself
      await stakingHbbft.stake(initialStakingAddresses[0], stakeUnit.mul(new BN(1)), {from: initialStakingAddresses[0]}).should.be.fulfilled;

      (await stakingHbbft.getPoolsToBeElected.call()).length.should.be.equal(0);

      await stakingHbbft.setValidatorSetAddress(accounts[7]).should.be.fulfilled;
      await stakingHbbft.clearUnremovableValidator(initialStakingAddresses[0], {from: accounts[7]}).should.be.fulfilled;

      (await stakingHbbft.getPoolsToBeElected.call()).should.be.deep.equal([
        initialStakingAddresses[0]
      ]);

      const likelihoodInfo = await stakingHbbft.getPoolsLikelihood.call();
      likelihoodInfo.likelihoods[0].should.be.bignumber.equal(stakeUnit);
      likelihoodInfo.sum.should.be.bignumber.equal(stakeUnit);
    });
    it('should add validator pool to the poolsToBeRemoved list', async () => {
      await stakingHbbft.setCurrentBlockNumber(100).should.be.fulfilled;
      (await stakingHbbft.getPoolsToBeRemoved.call()).should.be.deep.equal([
        initialStakingAddresses[1],
        initialStakingAddresses[2]
      ]);
      await stakingHbbft.setValidatorSetAddress(accounts[7]).should.be.fulfilled;
      await stakingHbbft.clearUnremovableValidator(initialStakingAddresses[0], {from: accounts[7]}).should.be.fulfilled;
      (await stakingHbbft.getPoolsToBeRemoved.call()).should.be.deep.equal([
        initialStakingAddresses[1],
        initialStakingAddresses[2],
        initialStakingAddresses[0]
      ]);
    });
    it('can only be called by the ValidatorSet contract', async () => {
      await stakingHbbft.setCurrentBlockNumber(100).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress(accounts[7]).should.be.fulfilled;
      await stakingHbbft.clearUnremovableValidator(initialStakingAddresses[0], {from: accounts[8]}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.clearUnremovableValidator(initialStakingAddresses[0], {from: accounts[7]}).should.be.fulfilled;
    });
    it('non-removable validator address cannot be zero', async () => {
      await stakingHbbft.setCurrentBlockNumber(100).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress(accounts[7]).should.be.fulfilled;
      await stakingHbbft.clearUnremovableValidator('0x0000000000000000000000000000000000000000', {from: accounts[7]}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.clearUnremovableValidator(initialStakingAddresses[0], {from: accounts[7]}).should.be.fulfilled;
    });
  });

  describe('incrementStakingEpoch()', async () => {
    it('should increment', async () => {
      (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(new BN(0));
      await stakingHbbft.setValidatorSetAddress(accounts[7]).should.be.fulfilled;
      await stakingHbbft.incrementStakingEpoch({from: accounts[7]}).should.be.fulfilled;
      (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(new BN(1));
    });
    it('can only be called by ValidatorSet contract', async () => {
      await stakingHbbft.setValidatorSetAddress(accounts[7]).should.be.fulfilled;
      await stakingHbbft.incrementStakingEpoch({from: accounts[8]}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.incrementStakingEpoch({from: accounts[7]}).should.be.fulfilled;
    });
  });

  describe('initialize()', async () => {
    beforeEach(async () => {
      await stakingHbbft.setCurrentBlockNumber(0);
    });
    it('should initialize successfully', async () => {
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        web3.utils.toWei('1', 'ether'), // _delegatorMinStake
        web3.utils.toWei('1', 'ether'), // _candidateMinStake
        120954, // _stakingEpochDuration
        0, // _stakingEpochStartBlock
        4320, // _stakeWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.fulfilled;
      new BN(120954).should.be.bignumber.equal(
        await stakingHbbft.stakingEpochDuration.call()
      );
      new BN(4320).should.be.bignumber.equal(
        await stakingHbbft.stakeWithdrawDisallowPeriod.call()
      );
      new BN(0).should.be.bignumber.equal(
        await stakingHbbft.stakingEpochStartBlock.call()
      );
      validatorSetHbbft.address.should.be.equal(
        await stakingHbbft.validatorSetContract.call()
      );
      '0x0000000000000000000000000000000000000000'.should.be.equal(
        await stakingHbbft.erc677TokenContract.call()
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
        web3.utils.toWei('1', 'ether'), // _delegatorMinStake
        web3.utils.toWei('1', 'ether'), // _candidateMinStake
        120954, // _stakingEpochDuration
        0, // _stakingEpochStartBlock
        4320, // _stakeWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.rejectedWith(ERROR_MSG);
    });
    it('should fail if delegatorMinStake is zero', async () => {
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        web3.utils.toWei('0', 'ether'), // _delegatorMinStake
        web3.utils.toWei('1', 'ether'), // _candidateMinStake
        120954, // _stakingEpochDuration
        0, // _stakingEpochStartBlock
        4320, // _stakeWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.rejectedWith(ERROR_MSG);
    });
    it('should fail if candidateMinStake is zero', async () => {
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        web3.utils.toWei('1', 'ether'), // _delegatorMinStake
        web3.utils.toWei('0', 'ether'), // _candidateMinStake
        120954, // _stakingEpochDuration
        0, // _stakingEpochStartBlock
        4320, // _stakeWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.rejectedWith(ERROR_MSG);
    });
    it('should fail if already initialized', async () => {
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        web3.utils.toWei('1', 'ether'), // _delegatorMinStake
        web3.utils.toWei('1', 'ether'), // _candidateMinStake
        120954, // _stakingEpochDuration
        0, // _stakingEpochStartBlock
        4320, // _stakeWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.fulfilled;
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        web3.utils.toWei('1', 'ether'), // _delegatorMinStake
        web3.utils.toWei('1', 'ether'), // _candidateMinStake
        120954, // _stakingEpochDuration
        0, // _stakingEpochStartBlock
        4320, // _stakeWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.rejectedWith(ERROR_MSG);
    });
    it('should fail if stakingEpochDuration is 0', async () => {
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        web3.utils.toWei('1', 'ether'), // _delegatorMinStake
        web3.utils.toWei('1', 'ether'), // _candidateMinStake
        0, // _stakingEpochDuration
        0, // _stakingEpochStartBlock
        4320, // _stakeWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.rejectedWith(ERROR_MSG);
    });
    it('should fail if stakeWithdrawDisallowPeriod is 0', async () => {
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        web3.utils.toWei('1', 'ether'), // _delegatorMinStake
        web3.utils.toWei('1', 'ether'), // _candidateMinStake
        120954, // _stakingEpochDuration
        0, // _stakingEpochStartBlock
        0, // _stakeWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.rejectedWith(ERROR_MSG);
    });
    it('should fail if stakeWithdrawDisallowPeriod >= stakingEpochDuration', async () => {
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        web3.utils.toWei('1', 'ether'), // _delegatorMinStake
        web3.utils.toWei('1', 'ether'), // _candidateMinStake
        120954, // _stakingEpochDuration
        0, // _stakingEpochStartBlock
        120954, // _stakeWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        web3.utils.toWei('1', 'ether'), // _delegatorMinStake
        web3.utils.toWei('1', 'ether'), // _candidateMinStake
        120954, // _stakingEpochDuration
        0, // _stakingEpochStartBlock
        4320, // _stakeWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.fulfilled;
    });
    it('should fail if some staking address is 0', async () => {
      initialStakingAddresses[0] = '0x0000000000000000000000000000000000000000';
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        web3.utils.toWei('1', 'ether'), // _delegatorMinStake
        web3.utils.toWei('1', 'ether'), // _candidateMinStake
        120954, // _stakingEpochDuration
        0, // _stakingEpochStartBlock
        4320, // _stakeWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.rejectedWith(ERROR_MSG);
    });
  });

  describe('moveStake()', async () => {
    let delegatorAddress;
    let erc677Token;
    let mintAmount;
    let stakeUnit;

    beforeEach(async () => {
      delegatorAddress = accounts[7];

      // Initialize StakingHbbft
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        web3.utils.toWei('1', 'ether'), // _delegatorMinStake
        web3.utils.toWei('1', 'ether'), // _candidateMinStake
        120954, // _stakingEpochDuration
        0, // _stakingEpochStartBlock
        4320, // _stakeWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.fulfilled;

      // Deploy ERC677 contract
      erc677Token = await ERC677BridgeTokenRewardable.new("STAKE", "STAKE", 18, {from: owner});

      // Mint some balance for delegator and candidates (imagine that they got some STAKE_UNITs from a bridge)
      stakeUnit = new BN(web3.utils.toWei('1', 'ether'));
      mintAmount = stakeUnit.mul(new BN(2));
      await erc677Token.mint(initialStakingAddresses[0], mintAmount, {from: owner}).should.be.fulfilled;
      await erc677Token.mint(initialStakingAddresses[1], mintAmount, {from: owner}).should.be.fulfilled;
      await erc677Token.mint(delegatorAddress, mintAmount, {from: owner}).should.be.fulfilled;
      mintAmount.should.be.bignumber.equal(await erc677Token.balanceOf.call(initialStakingAddresses[0]));
      mintAmount.should.be.bignumber.equal(await erc677Token.balanceOf.call(initialStakingAddresses[1]));
      mintAmount.should.be.bignumber.equal(await erc677Token.balanceOf.call(delegatorAddress));

      // Pass Staking contract address to ERC677 contract
      await erc677Token.setStakingContract(stakingHbbft.address, {from: owner}).should.be.fulfilled;
      stakingHbbft.address.should.be.equal(await erc677Token.stakingContract.call());

      // Pass ERC677 contract address to Staking contract
      '0x0000000000000000000000000000000000000000'.should.be.equal(
        await stakingHbbft.erc677TokenContract.call()
      );
      await stakingHbbft.setErc677TokenContract(erc677Token.address, {from: owner}).should.be.fulfilled;
      erc677Token.address.should.be.equal(await stakingHbbft.erc677TokenContract.call());

      // Place stakes
      await stakingHbbft.setCurrentBlockNumber(100).should.be.fulfilled;
      await validatorSetHbbft.setCurrentBlockNumber(100).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[0], mintAmount, {from: initialStakingAddresses[0]}).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[0], mintAmount, {from: delegatorAddress}).should.be.fulfilled;
    });

    it('should move entire stake', async () => {
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[0], delegatorAddress)).should.be.bignumber.equal(mintAmount);
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(new BN(0));
      await stakingHbbft.moveStake(initialStakingAddresses[0], initialStakingAddresses[1], mintAmount, {from: delegatorAddress}).should.be.fulfilled;
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[0], delegatorAddress)).should.be.bignumber.equal(new BN(0));
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(mintAmount);
    });
    it('should move part of the stake', async () => {
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[0], delegatorAddress)).should.be.bignumber.equal(mintAmount);
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(new BN(0));
      await stakingHbbft.moveStake(initialStakingAddresses[0], initialStakingAddresses[1], stakeUnit, {from: delegatorAddress}).should.be.fulfilled;
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[0], delegatorAddress)).should.be.bignumber.equal(stakeUnit);
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(stakeUnit);
    });
    it('should move part of the stake', async () => {
      await erc677Token.mint(delegatorAddress, mintAmount, {from: owner}).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: delegatorAddress}).should.be.fulfilled;

      const sourcePool = initialStakingAddresses[0];
      const targetPool = initialStakingAddresses[1];

      (await stakingHbbft.stakeAmount.call(sourcePool, delegatorAddress)).should.be.bignumber.equal(mintAmount);
      (await stakingHbbft.stakeAmount.call(targetPool, delegatorAddress)).should.be.bignumber.equal(mintAmount);

      const moveAmount = stakeUnit.div(new BN(2));
      moveAmount.should.be.bignumber.below(await stakingHbbft.delegatorMinStake.call());

      await stakingHbbft.moveStake(sourcePool, targetPool, moveAmount, {from: delegatorAddress}).should.be.fulfilled;
      (await stakingHbbft.stakeAmount.call(sourcePool, delegatorAddress)).should.be.bignumber.equal(mintAmount.sub(moveAmount));
      (await stakingHbbft.stakeAmount.call(targetPool, delegatorAddress)).should.be.bignumber.equal(mintAmount.add(moveAmount));
    });
    it('should fail for zero gas price', async () => {
      await stakingHbbft.moveStake(initialStakingAddresses[0], initialStakingAddresses[1], mintAmount, {from: delegatorAddress, gasPrice: 0}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.moveStake(initialStakingAddresses[0], initialStakingAddresses[1], mintAmount, {from: delegatorAddress}).should.be.fulfilled;
    });
    it('should fail if the source and destination addresses are the same', async () => {
      await stakingHbbft.moveStake(initialStakingAddresses[0], initialStakingAddresses[0], mintAmount, {from: delegatorAddress}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.moveStake(initialStakingAddresses[0], initialStakingAddresses[1], mintAmount, {from: delegatorAddress}).should.be.fulfilled;
    });
    it('should fail if the staker tries to move more than they have', async () => {
      await stakingHbbft.moveStake(initialStakingAddresses[0], initialStakingAddresses[1], mintAmount.mul(new BN(2)), {from: delegatorAddress}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.moveStake(initialStakingAddresses[0], initialStakingAddresses[1], mintAmount, {from: delegatorAddress}).should.be.fulfilled;
    });
  });

  describe('stake() [tokens]', async () => {
    let delegatorAddress;
    let erc677Token;
    let mintAmount;
    let candidateMinStake;
    let delegatorMinStake;

    beforeEach(async () => {
      delegatorAddress = accounts[7];

      // Initialize StakingHbbft
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        web3.utils.toWei('1', 'ether'), // _delegatorMinStake
        web3.utils.toWei('1', 'ether'), // _candidateMinStake
        120954, // _stakingEpochDuration
        0, // _stakingEpochStartBlock
        4320, // _stakeWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.fulfilled;

      candidateMinStake = await stakingHbbft.candidateMinStake.call();
      delegatorMinStake = await stakingHbbft.delegatorMinStake.call();

      // Deploy ERC677 contract
      erc677Token = await ERC677BridgeTokenRewardable.new("STAKE", "STAKE", 18, {from: owner});

      // Mint some balance for delegator and candidates (imagine that they got some STAKE_UNITs from a bridge)
      const stakeUnit = new BN(web3.utils.toWei('1', 'ether'));
      mintAmount = stakeUnit.mul(new BN(2));
      await erc677Token.mint(initialStakingAddresses[1], mintAmount, {from: owner}).should.be.fulfilled;
      await erc677Token.mint(delegatorAddress, mintAmount, {from: owner}).should.be.fulfilled;
      mintAmount.should.be.bignumber.equal(await erc677Token.balanceOf.call(initialStakingAddresses[1]));
      mintAmount.should.be.bignumber.equal(await erc677Token.balanceOf.call(delegatorAddress));

      // Pass Staking contract address to ERC677 contract
      await erc677Token.setStakingContract(stakingHbbft.address, {from: owner}).should.be.fulfilled;
      stakingHbbft.address.should.be.equal(await erc677Token.stakingContract.call());

      // Pass ERC677 contract address to Staking contract
      '0x0000000000000000000000000000000000000000'.should.be.equal(
        await stakingHbbft.erc677TokenContract.call()
      );
      await stakingHbbft.setErc677TokenContract(erc677Token.address, {from: owner}).should.be.fulfilled;
      erc677Token.address.should.be.equal(await stakingHbbft.erc677TokenContract.call());

      await stakingHbbft.setCurrentBlockNumber(100).should.be.fulfilled;
      await validatorSetHbbft.setCurrentBlockNumber(100).should.be.fulfilled;
    });

    it('should place a stake', async () => {
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], initialStakingAddresses[1])).should.be.bignumber.equal(new BN(0));
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(new BN(0));
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], initialStakingAddresses[1])).should.be.bignumber.equal(mintAmount);
      const result = await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: delegatorAddress}).should.be.fulfilled;
      result.logs[0].event.should.be.equal("PlacedStake");
      result.logs[0].args.toPoolStakingAddress.should.be.equal(initialStakingAddresses[1]);
      result.logs[0].args.staker.should.be.equal(delegatorAddress);
      result.logs[0].args.stakingEpoch.should.be.bignumber.equal(new BN(0));
      result.logs[0].args.amount.should.be.bignumber.equal(mintAmount);
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(mintAmount);
      (await stakingHbbft.stakeAmountTotal.call(initialStakingAddresses[1])).should.be.bignumber.equal(mintAmount.mul(new BN(2)));
    });
    it('should fail for zero gas price', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1], gasPrice: 0}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
    });
    it('should fail if erc677TokenContract address is not defined', async () => {
      await stakingHbbft.setErc677TokenContractMock('0x0000000000000000000000000000000000000000').should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.setErc677TokenContract(erc677Token.address, {from: owner}).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
    });
    it('should fail if erc677TokenContract address is defined but msg.value is not zero', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1], value: 1}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
    });
    it('should fail for a non-existing pool', async () => {
      await stakingHbbft.stake(accounts[10], mintAmount, {from: delegatorAddress}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.stake('0x0000000000000000000000000000000000000000', mintAmount, {from: delegatorAddress}).should.be.rejectedWith(ERROR_MSG);
    });
    it('should fail for a zero amount', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[1], new BN(0), {from: delegatorAddress}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: delegatorAddress}).should.be.fulfilled;
    });
    it('should fail for a banned validator', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
      await validatorSetHbbft.setRandomContract(accounts[8]).should.be.fulfilled;
      await validatorSetHbbft.removeMaliciousValidators([initialValidators[1]], {from: accounts[8]}).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: delegatorAddress}).should.be.rejectedWith(ERROR_MSG);
    });
    it('should only success in the allowed staking window', async () => {
      await stakingHbbft.setCurrentBlockNumber(117000).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.setCurrentBlockNumber(100).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
    });
    it('should fail if a candidate stakes less than CANDIDATE_MIN_STAKE', async () => {
      const halfOfCandidateMinStake = candidateMinStake.div(new BN(2));
      await stakingHbbft.stake(initialStakingAddresses[1], halfOfCandidateMinStake, {from: initialStakingAddresses[1]}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.stake(initialStakingAddresses[1], candidateMinStake, {from: initialStakingAddresses[1]}).should.be.fulfilled;
    });
    it('should fail if a delegator stakes less than DELEGATOR_MIN_STAKE', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], candidateMinStake, {from: initialStakingAddresses[1]}).should.be.fulfilled;
      const halfOfDelegatorMinStake = delegatorMinStake.div(new BN(2));
      await stakingHbbft.stake(initialStakingAddresses[1], halfOfDelegatorMinStake, {from: delegatorAddress}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.stake(initialStakingAddresses[1], delegatorMinStake, {from: delegatorAddress}).should.be.fulfilled;
    });
    it('should fail if a delegator stakes into an empty pool', async () => {
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], initialStakingAddresses[1])).should.be.bignumber.equal(new BN(0));
      await stakingHbbft.stake(initialStakingAddresses[1], delegatorMinStake, {from: delegatorAddress}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.stake(initialStakingAddresses[1], candidateMinStake, {from: initialStakingAddresses[1]}).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[1], delegatorMinStake, {from: delegatorAddress}).should.be.fulfilled;
    });
    it('should increase a stake amount', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], candidateMinStake, {from: initialStakingAddresses[1]}).should.be.fulfilled;
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(new BN(0));
      await stakingHbbft.stake(initialStakingAddresses[1], delegatorMinStake, {from: delegatorAddress}).should.be.fulfilled;
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(delegatorMinStake);
      await stakingHbbft.stake(initialStakingAddresses[1], delegatorMinStake, {from: delegatorAddress}).should.be.fulfilled;
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(delegatorMinStake.mul(new BN(2)));
    });
    it('should increase the stakeAmountByCurrentEpoch', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], candidateMinStake, {from: initialStakingAddresses[1]}).should.be.fulfilled;
      (await stakingHbbft.stakeAmountByCurrentEpoch.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(new BN(0));
      await stakingHbbft.stake(initialStakingAddresses[1], delegatorMinStake, {from: delegatorAddress}).should.be.fulfilled;
      (await stakingHbbft.stakeAmountByCurrentEpoch.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(delegatorMinStake);
      await stakingHbbft.stake(initialStakingAddresses[1], delegatorMinStake, {from: delegatorAddress}).should.be.fulfilled;
      (await stakingHbbft.stakeAmountByCurrentEpoch.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(delegatorMinStake.mul(new BN(2)));
    });
    it('should increase a total stake amount', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], candidateMinStake, {from: initialStakingAddresses[1]}).should.be.fulfilled;
      (await stakingHbbft.stakeAmountTotal.call(initialStakingAddresses[1])).should.be.bignumber.equal(candidateMinStake);
      await stakingHbbft.stake(initialStakingAddresses[1], delegatorMinStake, {from: delegatorAddress}).should.be.fulfilled;
      (await stakingHbbft.stakeAmountTotal.call(initialStakingAddresses[1])).should.be.bignumber.equal(candidateMinStake.add(delegatorMinStake));
      await stakingHbbft.stake(initialStakingAddresses[1], delegatorMinStake, {from: delegatorAddress}).should.be.fulfilled;
      (await stakingHbbft.stakeAmountTotal.call(initialStakingAddresses[1])).should.be.bignumber.equal(candidateMinStake.add(delegatorMinStake.mul(new BN(2))));
    });
    it('should add a delegator to the pool', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], candidateMinStake, {from: initialStakingAddresses[1]}).should.be.fulfilled;
      (await stakingHbbft.poolDelegators.call(initialStakingAddresses[1])).length.should.be.equal(0);
      await stakingHbbft.stake(initialStakingAddresses[1], delegatorMinStake, {from: delegatorAddress}).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[1], delegatorMinStake, {from: delegatorAddress}).should.be.fulfilled;
      (await stakingHbbft.poolDelegators.call(initialStakingAddresses[1])).should.be.deep.equal([delegatorAddress]);
    });
    it('should update pool\'s likelihood', async () => {
      let likelihoodInfo = await stakingHbbft.getPoolsLikelihood.call();
      likelihoodInfo.likelihoods.length.should.be.equal(0);
      likelihoodInfo.sum.should.be.bignumber.equal(new BN(0));
      await stakingHbbft.stake(initialStakingAddresses[1], candidateMinStake, {from: initialStakingAddresses[1]}).should.be.fulfilled;
      likelihoodInfo = await stakingHbbft.getPoolsLikelihood.call();
      likelihoodInfo.likelihoods[0].should.be.bignumber.equal(candidateMinStake);
      likelihoodInfo.sum.should.be.bignumber.equal(candidateMinStake);
      await stakingHbbft.stake(initialStakingAddresses[1], delegatorMinStake, {from: delegatorAddress}).should.be.fulfilled;
      likelihoodInfo = await stakingHbbft.getPoolsLikelihood.call();
      likelihoodInfo.likelihoods[0].should.be.bignumber.equal(candidateMinStake.add(delegatorMinStake));
      likelihoodInfo.sum.should.be.bignumber.equal(candidateMinStake.add(delegatorMinStake));
      await stakingHbbft.stake(initialStakingAddresses[1], delegatorMinStake, {from: delegatorAddress}).should.be.fulfilled;
      likelihoodInfo = await stakingHbbft.getPoolsLikelihood.call();
      likelihoodInfo.likelihoods[0].should.be.bignumber.equal(candidateMinStake.add(delegatorMinStake.mul(new BN(2))));
      likelihoodInfo.sum.should.be.bignumber.equal(candidateMinStake.add(delegatorMinStake.mul(new BN(2))));
    });
    it('should fail if the staker stakes more than they have', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount.mul(new BN(2)), {from: initialStakingAddresses[1]}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.stake(initialStakingAddresses[1], candidateMinStake, {from: initialStakingAddresses[1]}).should.be.fulfilled;
    });
    it('should decrease the balance of the staker and increase the balance of the Staking contract', async () => {
      (await erc677Token.balanceOf.call(stakingHbbft.address)).should.be.bignumber.equal(new BN(0));
      await stakingHbbft.stake(initialStakingAddresses[1], candidateMinStake, {from: initialStakingAddresses[1]}).should.be.fulfilled;
      (await erc677Token.balanceOf.call(initialStakingAddresses[1])).should.be.bignumber.equal(mintAmount.sub(candidateMinStake));
      (await erc677Token.balanceOf.call(stakingHbbft.address)).should.be.bignumber.equal(candidateMinStake);
    });
  });

  describe('stake() [native coins]', async () => {
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
        web3.utils.toWei('1', 'ether'), // _delegatorMinStake
        web3.utils.toWei('1', 'ether'), // _candidateMinStake
        120954, // _stakingEpochDuration
        0, // _stakingEpochStartBlock
        4320, // _stakeWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.fulfilled;

      candidateMinStake = await stakingHbbft.candidateMinStake.call();
      delegatorMinStake = await stakingHbbft.delegatorMinStake.call();

      await stakingHbbft.setCurrentBlockNumber(100).should.be.fulfilled;
      await validatorSetHbbft.setCurrentBlockNumber(100).should.be.fulfilled;
    });
    it('should place a stake', async () => {
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], initialStakingAddresses[1])).should.be.bignumber.equal(new BN(0));
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(new BN(0));
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: initialStakingAddresses[1], value: candidateMinStake}).should.be.fulfilled;
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], initialStakingAddresses[1])).should.be.bignumber.equal(candidateMinStake);
      const result = await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: delegatorAddress, value: delegatorMinStake}).should.be.fulfilled;
      result.logs[0].event.should.be.equal("PlacedStake");
      result.logs[0].args.toPoolStakingAddress.should.be.equal(initialStakingAddresses[1]);
      result.logs[0].args.staker.should.be.equal(delegatorAddress);
      result.logs[0].args.stakingEpoch.should.be.bignumber.equal(new BN(0));
      result.logs[0].args.amount.should.be.bignumber.equal(delegatorMinStake);
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(delegatorMinStake);
      (await stakingHbbft.stakeAmountTotal.call(initialStakingAddresses[1])).should.be.bignumber.equal(candidateMinStake.add(delegatorMinStake));
    });
    it('should fail for zero gas price', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: initialStakingAddresses[1], value: candidateMinStake, gasPrice: 0}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: initialStakingAddresses[1], value: candidateMinStake}).should.be.fulfilled;
    });
    it('should fail for a non-existing pool', async () => {
      await stakingHbbft.stake(accounts[10], 0, {from: delegatorAddress, value: delegatorMinStake}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.stake('0x0000000000000000000000000000000000000000', 0, {from: delegatorAddress, value: delegatorMinStake}).should.be.rejectedWith(ERROR_MSG);
    });
    it('should fail for a zero amount', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: initialStakingAddresses[1], value: candidateMinStake}).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: delegatorAddress, value: 0}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: delegatorAddress, value: delegatorMinStake}).should.be.fulfilled;
    });
    it('should fail for a banned validator', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: initialStakingAddresses[1], value: candidateMinStake}).should.be.fulfilled;
      await validatorSetHbbft.setRandomContract(accounts[8]).should.be.fulfilled;
      await validatorSetHbbft.removeMaliciousValidators([initialValidators[1]], {from: accounts[8]}).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: delegatorAddress, value: delegatorMinStake}).should.be.rejectedWith(ERROR_MSG);
    });
    it('should only success in the allowed staking window', async () => {
      await stakingHbbft.setCurrentBlockNumber(117000).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: initialStakingAddresses[1], value: candidateMinStake}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.setCurrentBlockNumber(100).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: initialStakingAddresses[1], value: candidateMinStake}).should.be.fulfilled;
    });
    it('should fail if a candidate stakes less than CANDIDATE_MIN_STAKE', async () => {
      const halfOfCandidateMinStake = candidateMinStake.div(new BN(2));
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: initialStakingAddresses[1], value: halfOfCandidateMinStake}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: initialStakingAddresses[1], value: candidateMinStake}).should.be.fulfilled;
    });
    it('should fail if a delegator stakes less than DELEGATOR_MIN_STAKE', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: initialStakingAddresses[1], value: candidateMinStake}).should.be.fulfilled;
      const halfOfDelegatorMinStake = delegatorMinStake.div(new BN(2));
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: delegatorAddress, value: halfOfDelegatorMinStake}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: delegatorAddress, value: delegatorMinStake}).should.be.fulfilled;
    });
    it('should fail if a delegator stakes into an empty pool', async () => {
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], initialStakingAddresses[1])).should.be.bignumber.equal(new BN(0));
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: delegatorAddress, value: delegatorMinStake}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: initialStakingAddresses[1], value: candidateMinStake}).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: delegatorAddress, value: delegatorMinStake}).should.be.fulfilled;
    });
    it('should increase a stake amount', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: initialStakingAddresses[1], value: candidateMinStake}).should.be.fulfilled;
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(new BN(0));
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: delegatorAddress, value: delegatorMinStake}).should.be.fulfilled;
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(delegatorMinStake);
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: delegatorAddress, value: delegatorMinStake}).should.be.fulfilled;
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(delegatorMinStake.mul(new BN(2)));
    });
    it('should increase the stakeAmountByCurrentEpoch', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: initialStakingAddresses[1], value: candidateMinStake}).should.be.fulfilled;
      (await stakingHbbft.stakeAmountByCurrentEpoch.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(new BN(0));
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: delegatorAddress, value: delegatorMinStake}).should.be.fulfilled;
      (await stakingHbbft.stakeAmountByCurrentEpoch.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(delegatorMinStake);
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: delegatorAddress, value: delegatorMinStake}).should.be.fulfilled;
      (await stakingHbbft.stakeAmountByCurrentEpoch.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(delegatorMinStake.mul(new BN(2)));
    });
    it('should increase a total stake amount', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: initialStakingAddresses[1], value: candidateMinStake}).should.be.fulfilled;
      (await stakingHbbft.stakeAmountTotal.call(initialStakingAddresses[1])).should.be.bignumber.equal(candidateMinStake);
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: delegatorAddress, value: delegatorMinStake}).should.be.fulfilled;
      (await stakingHbbft.stakeAmountTotal.call(initialStakingAddresses[1])).should.be.bignumber.equal(candidateMinStake.add(delegatorMinStake));
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: delegatorAddress, value: delegatorMinStake}).should.be.fulfilled;
      (await stakingHbbft.stakeAmountTotal.call(initialStakingAddresses[1])).should.be.bignumber.equal(candidateMinStake.add(delegatorMinStake.mul(new BN(2))));
    });
    it('should add a delegator to the pool', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: initialStakingAddresses[1], value: candidateMinStake}).should.be.fulfilled;
      (await stakingHbbft.poolDelegators.call(initialStakingAddresses[1])).length.should.be.equal(0);
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: delegatorAddress, value: delegatorMinStake}).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: delegatorAddress, value: delegatorMinStake}).should.be.fulfilled;
      (await stakingHbbft.poolDelegators.call(initialStakingAddresses[1])).should.be.deep.equal([delegatorAddress]);
    });
    it('should update pool\'s likelihood', async () => {
      let likelihoodInfo = await stakingHbbft.getPoolsLikelihood.call();
      likelihoodInfo.likelihoods.length.should.be.equal(0);
      likelihoodInfo.sum.should.be.bignumber.equal(new BN(0));
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: initialStakingAddresses[1], value: candidateMinStake}).should.be.fulfilled;
      likelihoodInfo = await stakingHbbft.getPoolsLikelihood.call();
      likelihoodInfo.likelihoods[0].should.be.bignumber.equal(candidateMinStake);
      likelihoodInfo.sum.should.be.bignumber.equal(candidateMinStake);
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: delegatorAddress, value: delegatorMinStake}).should.be.fulfilled;
      likelihoodInfo = await stakingHbbft.getPoolsLikelihood.call();
      likelihoodInfo.likelihoods[0].should.be.bignumber.equal(candidateMinStake.add(delegatorMinStake));
      likelihoodInfo.sum.should.be.bignumber.equal(candidateMinStake.add(delegatorMinStake));
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: delegatorAddress, value: delegatorMinStake}).should.be.fulfilled;
      likelihoodInfo = await stakingHbbft.getPoolsLikelihood.call();
      likelihoodInfo.likelihoods[0].should.be.bignumber.equal(candidateMinStake.add(delegatorMinStake.mul(new BN(2))));
      likelihoodInfo.sum.should.be.bignumber.equal(candidateMinStake.add(delegatorMinStake.mul(new BN(2))));
    });
    it('should decrease the balance of the staker and increase the balance of the Staking contract', async () => {
      (await web3.eth.getBalance(stakingHbbft.address)).should.be.equal('0');
      const initialBalance = new BN(await web3.eth.getBalance(initialStakingAddresses[1]));
      await stakingHbbft.stake(initialStakingAddresses[1], 0, {from: initialStakingAddresses[1], value: candidateMinStake}).should.be.fulfilled;
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
        web3.utils.toWei('1', 'ether'), // _delegatorMinStake
        web3.utils.toWei('1', 'ether'), // _candidateMinStake
        120954, // _stakingEpochDuration
        0, // _stakingEpochStartBlock
        4320, // _stakeWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.fulfilled;
      await stakingHbbft.setCurrentBlockNumber(100).should.be.fulfilled;
      await validatorSetHbbft.setCurrentBlockNumber(100).should.be.fulfilled;
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
      await stakingHbbft.removePool(initialStakingAddresses[0], {from: accounts[8]}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.removePool(initialStakingAddresses[0], {from: accounts[7]}).should.be.fulfilled;
    });
    it('shouldn\'t remove a nonexistent pool', async () => {
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
      // Deploy ERC677 contract
      const erc677Token = await ERC677BridgeTokenRewardable.new("STAKE", "STAKE", 18, {from: owner});

      // Mint some balance for candidate (imagine that the candidate got 2 STAKE_UNITs from a bridge)
      const stakeUnit = new BN(web3.utils.toWei('1', 'ether'));
      const mintAmount = stakeUnit.mul(new BN(2));
      await erc677Token.mint(initialStakingAddresses[0], mintAmount, {from: owner}).should.be.fulfilled;
      mintAmount.should.be.bignumber.equal(await erc677Token.balanceOf.call(initialStakingAddresses[0]));

      // Pass Staking contract address to ERC677 contract
      await erc677Token.setStakingContract(stakingHbbft.address, {from: owner}).should.be.fulfilled;
      stakingHbbft.address.should.be.equal(await erc677Token.stakingContract.call());

      // Pass ERC677 contract address to Staking contract
      '0x0000000000000000000000000000000000000000'.should.be.equal(
        await stakingHbbft.erc677TokenContract.call()
      );
      await stakingHbbft.setErc677TokenContract(erc677Token.address, {from: owner}).should.be.fulfilled;
      erc677Token.address.should.be.equal(await stakingHbbft.erc677TokenContract.call());

      // The first validator places stake for themselves
      (await stakingHbbft.getPoolsToBeElected.call()).length.should.be.deep.equal(0);
      (await stakingHbbft.getPoolsToBeRemoved.call()).should.be.deep.equal(initialStakingAddresses);
      await stakingHbbft.stake(initialStakingAddresses[0], stakeUnit.mul(new BN(1)), {from: initialStakingAddresses[0]}).should.be.fulfilled;
      (await stakingHbbft.stakeAmountTotal.call(initialStakingAddresses[0])).should.be.bignumber.equal(stakeUnit);
      (await stakingHbbft.getPoolsToBeElected.call()).should.be.deep.equal([initialStakingAddresses[0]]);
      (await stakingHbbft.getPoolsToBeRemoved.call()).should.be.deep.equal([
        initialStakingAddresses[2],
        initialStakingAddresses[1]
      ]);

      // Remove the pool
      await stakingHbbft.setValidatorSetAddress(accounts[7]).should.be.fulfilled;
      (await stakingHbbft.poolInactiveIndex.call(initialStakingAddresses[0])).should.be.bignumber.equal(new BN(0));
      await stakingHbbft.removePool(initialStakingAddresses[0], {from: accounts[7]}).should.be.fulfilled;
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
        web3.utils.toWei('1', 'ether'), // _delegatorMinStake
        web3.utils.toWei('1', 'ether'), // _candidateMinStake
        120954, // _stakingEpochDuration
        0, // _stakingEpochStartBlock
        4320, // _stakeWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.fulfilled;
      await stakingHbbft.setCurrentBlockNumber(100).should.be.fulfilled;
    });

    it('should fail for zero gas price', async () => {
      await stakingHbbft.setValidatorSetAddress(accounts[7]).should.be.fulfilled;
      await stakingHbbft.incrementStakingEpoch({from: accounts[7]}).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
      await stakingHbbft.removeMyPool({from: initialStakingAddresses[0], gasPrice: 0}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.removeMyPool({from: initialStakingAddresses[0]}).should.be.fulfilled;
    });
    it('should fail if Staking contract is not initialized', async () => {
      await stakingHbbft.setValidatorSetAddress(accounts[7]).should.be.fulfilled;
      await stakingHbbft.incrementStakingEpoch({from: accounts[7]}).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress('0x0000000000000000000000000000000000000000').should.be.fulfilled;
      await stakingHbbft.removeMyPool({from: initialStakingAddresses[0]}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
      await stakingHbbft.removeMyPool({from: initialStakingAddresses[0]}).should.be.fulfilled;
    });
    it('should fail for initial validator during the initial staking epoch', async () => {
      (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(new BN(0));
      (await validatorSetHbbft.isValidator.call(initialValidators[0])).should.be.equal(true);
      (await validatorSetHbbft.miningByStakingAddress.call(initialStakingAddresses[0])).should.be.equal(initialValidators[0]);
      await stakingHbbft.removeMyPool({from: initialStakingAddresses[0]}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.setValidatorSetAddress(accounts[7]).should.be.fulfilled;
      await stakingHbbft.incrementStakingEpoch({from: accounts[7]}).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
      await stakingHbbft.removeMyPool({from: initialStakingAddresses[0]}).should.be.fulfilled
    });
    it('should fail for a non-removable validator', async () => {
      // Deploy Staking contract
      stakingHbbft = await StakingHbbftTokens.new();
      stakingHbbft = await AdminUpgradeabilityProxy.new(stakingHbbft.address, owner, []);
      stakingHbbft = await StakingHbbftTokens.at(stakingHbbft.address);

      // Deploy ValidatorSet contract
      validatorSetHbbft = await ValidatorSetHbbft.new();
      validatorSetHbbft = await AdminUpgradeabilityProxy.new(validatorSetHbbft.address, owner, []);
      validatorSetHbbft = await ValidatorSetHbbft.at(validatorSetHbbft.address);

      // Initialize ValidatorSet
      await validatorSetHbbft.initialize(
        blockRewardHbbft.address, // _blockRewardContract
        '0x3000000000000000000000000000000000000001', // _randomContract
        stakingHbbft.address, // _stakingContract
        initialValidators, // _initialMiningAddresses
        initialStakingAddresses, // _initialStakingAddresses
        true // _firstValidatorIsUnremovable
      ).should.be.fulfilled;

      // Initialize StakingHbbft
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        web3.utils.toWei('1', 'ether'), // _delegatorMinStake
        web3.utils.toWei('1', 'ether'), // _candidateMinStake
        120954, // _stakingEpochDuration
        0, // _stakingEpochStartBlock
        4320, // _stakeWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.fulfilled;

      await stakingHbbft.setCurrentBlockNumber(100).should.be.fulfilled;

      (await stakingHbbft.getPools.call()).should.be.deep.equal(initialStakingAddresses);
      await stakingHbbft.setValidatorSetAddress(accounts[7]).should.be.fulfilled;
      await stakingHbbft.incrementStakingEpoch({from: accounts[7]}).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
      await stakingHbbft.removeMyPool({from: initialStakingAddresses[0]}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.removeMyPool({from: initialStakingAddresses[1]}).should.be.fulfilled;
      (await stakingHbbft.getPools.call()).should.be.deep.equal([
        initialStakingAddresses[0],
        initialStakingAddresses[2]
      ]);
    });
  });

  describe('withdraw()', async () => {
    let delegatorAddress;
    let erc677Token;
    let mintAmount;
    let candidateMinStake;
    let delegatorMinStake;

    beforeEach(async () => {
      delegatorAddress = accounts[7];

      // Initialize StakingHbbft
      await stakingHbbft.initialize(
        validatorSetHbbft.address, // _validatorSetContract
        initialStakingAddresses, // _initialStakingAddresses
        web3.utils.toWei('1', 'ether'), // _delegatorMinStake
        web3.utils.toWei('1', 'ether'), // _candidateMinStake
        120954, // _stakingEpochDuration
        0, // _stakingEpochStartBlock
        4320, // _stakeWithdrawDisallowPeriod
        initialValidatorsPubKeysSplit, // _publicKeys
        initialValidatorsIpAddresses // _internetAddresses
      ).should.be.fulfilled;

      candidateMinStake = await stakingHbbft.candidateMinStake.call();
      delegatorMinStake = await stakingHbbft.delegatorMinStake.call();

      // Deploy ERC677 contract
      erc677Token = await ERC677BridgeTokenRewardable.new("STAKE", "STAKE", 18, {from: owner});

      // Mint some balance for delegator and candidates (imagine that they got some STAKE_UNITs from a bridge)
      const stakeUnit = new BN(web3.utils.toWei('1', 'ether'));
      mintAmount = stakeUnit.mul(new BN(2));
      await erc677Token.mint(initialStakingAddresses[0], mintAmount, {from: owner}).should.be.fulfilled;
      await erc677Token.mint(initialStakingAddresses[1], mintAmount, {from: owner}).should.be.fulfilled;
      await erc677Token.mint(initialStakingAddresses[2], mintAmount, {from: owner}).should.be.fulfilled;
      await erc677Token.mint(delegatorAddress, mintAmount, {from: owner}).should.be.fulfilled;
      mintAmount.should.be.bignumber.equal(await erc677Token.balanceOf.call(initialStakingAddresses[1]));
      mintAmount.should.be.bignumber.equal(await erc677Token.balanceOf.call(delegatorAddress));

      // Pass Staking contract address to ERC677 contract
      await erc677Token.setStakingContract(stakingHbbft.address, {from: owner}).should.be.fulfilled;
      stakingHbbft.address.should.be.equal(await erc677Token.stakingContract.call());

      // Pass ERC677 contract address to Staking contract
      '0x0000000000000000000000000000000000000000'.should.be.equal(
        await stakingHbbft.erc677TokenContract.call()
      );
      await stakingHbbft.setErc677TokenContract(erc677Token.address, {from: owner}).should.be.fulfilled;
      erc677Token.address.should.be.equal(await stakingHbbft.erc677TokenContract.call());

      await stakingHbbft.setCurrentBlockNumber(100).should.be.fulfilled;
      await validatorSetHbbft.setCurrentBlockNumber(100).should.be.fulfilled;
    });

    it('should withdraw a stake', async () => {
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], initialStakingAddresses[1])).should.be.bignumber.equal(new BN(0));
      (await stakingHbbft.stakeAmountByCurrentEpoch.call(initialStakingAddresses[1], initialStakingAddresses[1])).should.be.bignumber.equal(new BN(0));
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(new BN(0));
      (await stakingHbbft.stakeAmountByCurrentEpoch.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(new BN(0));
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], initialStakingAddresses[1])).should.be.bignumber.equal(mintAmount);
      (await stakingHbbft.stakeAmountByCurrentEpoch.call(initialStakingAddresses[1], initialStakingAddresses[1])).should.be.bignumber.equal(mintAmount);
      (await erc677Token.balanceOf.call(initialStakingAddresses[1])).should.be.bignumber.equal(new BN(0));

      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: delegatorAddress}).should.be.fulfilled;
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(mintAmount);
      (await stakingHbbft.stakeAmountByCurrentEpoch.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(mintAmount);
      (await stakingHbbft.stakeAmountTotal.call(initialStakingAddresses[1])).should.be.bignumber.equal(mintAmount.mul(new BN(2)));
      (await erc677Token.balanceOf.call(delegatorAddress)).should.be.bignumber.equal(new BN(0));

      const result = await stakingHbbft.withdraw(initialStakingAddresses[1], mintAmount, {from: delegatorAddress}).should.be.fulfilled;
      result.logs[0].event.should.be.equal("WithdrewStake");
      result.logs[0].args.fromPoolStakingAddress.should.be.equal(initialStakingAddresses[1]);
      result.logs[0].args.staker.should.be.equal(delegatorAddress);
      result.logs[0].args.stakingEpoch.should.be.bignumber.equal(new BN(0));
      result.logs[0].args.amount.should.be.bignumber.equal(mintAmount);
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(new BN(0));
      (await stakingHbbft.stakeAmountByCurrentEpoch.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(new BN(0));
      (await stakingHbbft.stakeAmountTotal.call(initialStakingAddresses[1])).should.be.bignumber.equal(mintAmount);
      (await erc677Token.balanceOf.call(delegatorAddress)).should.be.bignumber.equal(mintAmount);
    });
    it('should fail for zero gas price', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
      await stakingHbbft.withdraw(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1], gasPrice: 0}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.withdraw(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
    });
    it('should fail if not initialized', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
      await stakingHbbft.setValidatorSetAddress('0x0000000000000000000000000000000000000000').should.be.fulfilled;
      await stakingHbbft.withdraw(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address).should.be.fulfilled;
      await stakingHbbft.withdraw(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
    });
    it('should fail for a zero pool address', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
      await stakingHbbft.withdraw('0x0000000000000000000000000000000000000000', mintAmount, {from: initialStakingAddresses[1]}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.withdraw(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
    });
    it('should fail for a zero amount', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
      await stakingHbbft.withdraw(initialStakingAddresses[1], new BN(0), {from: initialStakingAddresses[1]}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.withdraw(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
    });
    it('shouldn\'t allow withdrawing from a banned pool', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: delegatorAddress}).should.be.fulfilled;
      await validatorSetHbbft.setBannedUntil(initialValidators[1], 100).should.be.fulfilled;
      await stakingHbbft.withdraw(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.withdraw(initialStakingAddresses[1], mintAmount, {from: delegatorAddress}).should.be.rejectedWith(ERROR_MSG);
      await validatorSetHbbft.setBannedUntil(initialValidators[1], 0).should.be.fulfilled;
      await stakingHbbft.withdraw(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
      await stakingHbbft.withdraw(initialStakingAddresses[1], mintAmount, {from: delegatorAddress}).should.be.fulfilled;
    });
    it('shouldn\'t allow withdrawing during the stakeWithdrawDisallowPeriod', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
      await stakingHbbft.setCurrentBlockNumber(117000).should.be.fulfilled;
      await validatorSetHbbft.setCurrentBlockNumber(117000).should.be.fulfilled;
      await stakingHbbft.withdraw(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.setCurrentBlockNumber(116000).should.be.fulfilled;
      await validatorSetHbbft.setCurrentBlockNumber(116000).should.be.fulfilled;
      await stakingHbbft.withdraw(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
    });
    it('should fail if non-zero residue is less than CANDIDATE_MIN_STAKE', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
      await stakingHbbft.withdraw(initialStakingAddresses[1], mintAmount.sub(candidateMinStake).add(new BN(1)), {from: initialStakingAddresses[1]}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.withdraw(initialStakingAddresses[1], mintAmount.sub(candidateMinStake), {from: initialStakingAddresses[1]}).should.be.fulfilled;
      await stakingHbbft.withdraw(initialStakingAddresses[1], candidateMinStake, {from: initialStakingAddresses[1]}).should.be.fulfilled;
    });
    it('should fail if non-zero residue is less than DELEGATOR_MIN_STAKE', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: delegatorAddress}).should.be.fulfilled;
      await stakingHbbft.withdraw(initialStakingAddresses[1], mintAmount.sub(delegatorMinStake).add(new BN(1)), {from: delegatorAddress}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.withdraw(initialStakingAddresses[1], mintAmount.sub(delegatorMinStake), {from: delegatorAddress}).should.be.fulfilled;
      await stakingHbbft.withdraw(initialStakingAddresses[1], delegatorMinStake, {from: delegatorAddress}).should.be.fulfilled;
    });
    it('should fail if withdraw more than staked', async () => {
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
      await stakingHbbft.withdraw(initialStakingAddresses[1], mintAmount.add(new BN(1)), {from: initialStakingAddresses[1]}).should.be.rejectedWith(ERROR_MSG);
      await stakingHbbft.withdraw(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
    });
    it('should fail if withdraw already ordered amount', async () => {
      // Set `initiateChangeAllowed` boolean flag to `true`
      await validatorSetHbbft.setCurrentBlockNumber(1).should.be.fulfilled;
      await validatorSetHbbft.setSystemAddress(owner).should.be.fulfilled;
      await validatorSetHbbft.finalizeChange({from: owner}).should.be.fulfilled;
      await validatorSetHbbft.setCurrentBlockNumber(100).should.be.fulfilled;

      // Place a stake during the initial staking epoch
      (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(new BN(0));
      await stakingHbbft.stake(initialStakingAddresses[0], mintAmount, {from: initialStakingAddresses[0]}).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[2], mintAmount, {from: initialStakingAddresses[2]}).should.be.fulfilled;
      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: delegatorAddress}).should.be.fulfilled;

      // Change staking epoch
      await stakingHbbft.setCurrentBlockNumber(120954).should.be.fulfilled;
      await validatorSetHbbft.setCurrentBlockNumber(120954).should.be.fulfilled;
      await validatorSetHbbft.setBlockRewardContract(accounts[7]).should.be.fulfilled;
      await validatorSetHbbft.newValidatorSet({from: accounts[7]}).should.be.fulfilled;
      await validatorSetHbbft.setBlockRewardContract(blockRewardHbbft.address).should.be.fulfilled;
      await stakingHbbft.setCurrentBlockNumber(120970).should.be.fulfilled;
      await validatorSetHbbft.setCurrentBlockNumber(120970).should.be.fulfilled;
      (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(new BN(1));

      // Finalize a new validator set
      await blockRewardHbbft.initialize(validatorSetHbbft.address).should.be.fulfilled;
      await validatorSetHbbft.emitInitiateChange().should.be.fulfilled;
      await validatorSetHbbft.finalizeChange({from: owner}).should.be.fulfilled;

      // Order withdrawal
      const orderedAmount = mintAmount.div(new BN(4));
      await stakingHbbft.orderWithdraw(initialStakingAddresses[1], orderedAmount, {from: delegatorAddress}).should.be.fulfilled;

      // The second validator removes their pool
      (await validatorSetHbbft.isValidator.call(initialValidators[1])).should.be.equal(true);
      (await stakingHbbft.getPoolsInactive.call()).length.should.be.equal(0);
      await stakingHbbft.removeMyPool({from: initialStakingAddresses[1]}).should.be.fulfilled;
      (await stakingHbbft.getPoolsInactive.call()).should.be.deep.equal([initialStakingAddresses[1]]);

      // Change staking epoch and enqueue pending validators
      await stakingHbbft.setCurrentBlockNumber(120954*2).should.be.fulfilled;
      await validatorSetHbbft.setCurrentBlockNumber(120954*2).should.be.fulfilled;
      await validatorSetHbbft.setBlockRewardContract(accounts[7]).should.be.fulfilled;
      await validatorSetHbbft.newValidatorSet({from: accounts[7]}).should.be.fulfilled;
      await validatorSetHbbft.setBlockRewardContract(blockRewardHbbft.address).should.be.fulfilled;
      await stakingHbbft.setCurrentBlockNumber(120970*2).should.be.fulfilled;
      await validatorSetHbbft.setCurrentBlockNumber(120970*2).should.be.fulfilled;
      (await stakingHbbft.stakingEpoch.call()).should.be.bignumber.equal(new BN(2));

      // Finalize a new validator set
      await validatorSetHbbft.emitInitiateChange().should.be.fulfilled;
      await validatorSetHbbft.finalizeChange({from: owner}).should.be.fulfilled;
      (await validatorSetHbbft.isValidator.call(initialValidators[1])).should.be.equal(false);

      // Check withdrawal for a delegator
      const restOfAmount = mintAmount.mul(new BN(3)).div(new BN(4));
      (await stakingHbbft.poolDelegators.call(initialStakingAddresses[1])).should.be.deep.equal([delegatorAddress]);
      (await stakingHbbft.stakeAmount.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(restOfAmount);
      (await stakingHbbft.stakeAmountByCurrentEpoch.call(initialStakingAddresses[1], delegatorAddress)).should.be.bignumber.equal(new BN(0));
      await stakingHbbft.withdraw(initialStakingAddresses[1], mintAmount, {from: delegatorAddress}).should.be.rejectedWith(ERROR_MSG);
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

      await stakingHbbft.stake(initialStakingAddresses[1], mintAmount, {from: initialStakingAddresses[1]}).should.be.fulfilled;

      likelihoodInfo = await stakingHbbft.getPoolsLikelihood.call();
      likelihoodInfo.likelihoods[0].should.be.bignumber.equal(mintAmount);
      likelihoodInfo.sum.should.be.bignumber.equal(mintAmount);

      await stakingHbbft.withdraw(initialStakingAddresses[1], mintAmount.div(new BN(2)), {from: initialStakingAddresses[1]}).should.be.fulfilled;

      likelihoodInfo = await stakingHbbft.getPoolsLikelihood.call();
      likelihoodInfo.likelihoods[0].should.be.bignumber.equal(mintAmount.div(new BN(2)));
      likelihoodInfo.sum.should.be.bignumber.equal(mintAmount.div(new BN(2)));
    });
    // TODO: add unit tests for native coin withdrawal
  });

  // TODO: ...add other tests...

  async function accrueBridgeFees() {
    const fee = web3.utils.toWei('1');
    await blockRewardHbbft.setNativeToErcBridgesAllowed([owner], {from: owner}).should.be.fulfilled;
    await blockRewardHbbft.setErcToNativeBridgesAllowed([owner], {from: owner}).should.be.fulfilled;
    await blockRewardHbbft.addBridgeTokenFeeReceivers(fee, {from: owner}).should.be.fulfilled;
    await blockRewardHbbft.addBridgeNativeFeeReceivers(fee, {from: owner}).should.be.fulfilled;
    (await blockRewardHbbft.bridgeTokenFee.call()).should.be.bignumber.equal(fee);
    (await blockRewardHbbft.bridgeNativeFee.call()).should.be.bignumber.equal(fee);
    return new BN(fee);
  }

  async function callFinalizeChange() {
    await validatorSetHbbft.setSystemAddress(owner).should.be.fulfilled;
    await validatorSetHbbft.finalizeChange({from: owner}).should.be.fulfilled;
    await validatorSetHbbft.setSystemAddress('0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE').should.be.fulfilled;
  }

  async function callReward() {
    const validators = await validatorSetHbbft.getValidators.call();
    await blockRewardHbbft.setSystemAddress(owner).should.be.fulfilled;
    const {logs} = await blockRewardHbbft.reward([validators[0]], [0], {from: owner}).should.be.fulfilled;

    // Emulate minting native coins
    logs[0].event.should.be.equal("MintedNative");
    const receivers = logs[0].args.receivers;
    const rewards = logs[0].args.rewards;
    for (let i = 0; i < receivers.length; i++) {
      await blockRewardHbbft.sendCoins({from: owner, value: rewards[i]}).should.be.fulfilled;
    }

    await blockRewardHbbft.setSystemAddress('0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE').should.be.fulfilled;
  }

  async function setCurrentBlockNumber(blockNumber) {
    await blockRewardHbbft.setCurrentBlockNumber(blockNumber).should.be.fulfilled;
    await randomHbbft.setCurrentBlockNumber(blockNumber).should.be.fulfilled;
    await stakingHbbft.setCurrentBlockNumber(blockNumber).should.be.fulfilled;
    await validatorSetHbbft.setCurrentBlockNumber(blockNumber).should.be.fulfilled;
  }
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
