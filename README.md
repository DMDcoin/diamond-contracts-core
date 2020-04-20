# HBBFT - POSDAO Smart Contracts

Implementation of the HBBFT-POSDAO consensus algorithm in [Solidity](https://solidity.readthedocs.io).

## About

POSDAO is a Proof-of-Stake (POS) algorithm implemented as a decentralized autonomous organization (DAO). It is designed to provide a decentralized, fair, and energy efficient consensus for public chains. The algorithm works as a set of smart contracts written in Solidity. POSDAO can be implemented with any general purpose BFT consensus protocol. In the current version Honeybadger BFT (HBBFT) is chosen, which is leaderless and with instant finality. It incentivizes actors to behave in the best interests of a network.

The algorithm provides a Sybil control mechanism for reporting malicious validators and adjusting their stake, distributing a block reward, and managing a set of validators.  

## POSDAO Repositories and Resources

- White paper https://forum.poa.network/t/posdao-white-paper/2208
- Backported Open Ethereum client with all POSDAO features https://github.com/poanetwork/open-ethereum/tree/posdao-backport
- Original Open Ethereum client supporting POSDAO features https://github.com/OpenEthereum/open-ethereum starting from v2.7.2 (except [posdaoTransition spec option](https://github.com/OpenEthereum/open-ethereum/pull/11245) which waits to be released in the next version)

## Smart Contract Summaries

_Note: The following descriptions are for HBBFT contracts only. There is also an AuRa implementation that can be found [here](https://github.com/poanetwork/posdao-contracts). All contracts are located in the `contracts` directory._

- `BlockRewardHbbft`: generates and distributes rewards according to the logic and formulas described in the white paper. Main features include:
  - mints native coins;
  - makes a snapshot of the validators stakes at the beginning of each staking epoch. That snapshot is used by the `StakingHbbft.claimReward` function to transfer rewards to validators and their delegators.

- `Certifier`: allows validators to use a zero gas price for their service transactions (see [Parity Wiki](https://wiki.parity.io/Permissioning.html#gas-price) for more info). The following functions are considered service transactions:
  - ValidatorSetHbbft.reportMalicious

- `InitializerHbbft`: used once on network startup and then destroyed. This contract is needed for initializing upgradable contracts since an upgradable contract can't have the constructor. The bytecode of this contract is written by the `scripts/make_spec_hbbft.js` into `spec.json` along with other contracts when initializing on genesis block.

- `RandomHbbft`: stores random numbers written by the HBBFT engine. Random numbers are used to form a new validator set at the beginning of each staking epoch by the `ValidatorSet` contract. There are two key functions:
  - `setCurrentSeed`. This is a setter that can only be called by the HBBFT engine in order to set the newly generated random number that is gonna be used for the new validator set selection.
  - `currentSeed`. This public getter is used by the `ValidatorSetHbbft` contract at a predefined block of each staking epoch to get the accumulated random seed for randomly choosing new validators among active pools. It can also be used by anyone who wants to use the network's random seed.

- `Registry`: stores human-readable keys associated with addresses, like DNS information (see [Parity Wiki](https://wiki.parity.io/Parity-name-registry.html)). This contract is needed primarily to store the address of the `Certifier` contract (see [Parity Wiki](https://wiki.parity.io/Permissioning.html#gas-price) for details).

- `StakingHbbft`: contains staking logic including:
  - creating, storing, and removing pools by candidates and validators;
  - staking coins by participants (delegators, candidates, or validators) into the pools;
  - storing participants’ stakes;
  - withdrawing coins and rewards by participants from the pools;
  - moving coins between pools by participant.

- `TxPermission`: controls the use of zero gas price by validators in service transactions, protecting the network against "transaction spamming" by malicious validators. The protection logic is declared in the `allowedTxTypes` function.

- `ValidatorSetHbbft`: stores the current validator set and contains the logic for choosing new validators at the beginning of each staking epoch. The logic uses a random seed stored in the `RandomHbbft` contract. Also, ValidatorSetHbbft is responsible for discovering and removing malicious validators. This contract is based on `reporting ValidatorSet` [described in Parity Wiki](https://wiki.parity.io/Validator-Set.html#reporting-contract).


## Usage

### Install Dependencies

```bash
$ npm install
```

### Testing

To run unit tests:

```bash
$ npm run test 
```

### Flatten

Flattened contracts can be used to verify the contract code in a block explorer like BlockScout or Etherscan. See https://docs.blockscout.com/for-users/smart-contract-interaction/verifying-a-smart-contract for Blockscout verification instructions.

To prepare flattened version of the contracts:

```bash
$ npm run flat
```

Once flattened, the contracts are available in the `flat` directory.

## Contributing

See the [CONTRIBUTING](CONTRIBUTING.md) document for contribution, testing and pull request protocol.

## License

Pending
