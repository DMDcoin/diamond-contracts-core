---
id: index
title: POSDAO Smart Contracts Docs
---

## Navigation

POSDAO smart contracts are located in the contracts directory, which contains the root contracts as well as base and upgradeability subdirectories. View the documentation by selecting a contract from the menu. To return to the repo, go to https://github.com/lukso/hbbft-posdao-contracts

- **base:** base contracts from which the root contracts inherit.
- **upgradeability:** upgradeability and contract storage management.
- **root:** POSDAO functional contracts.

## Smart Contract Summaries

- **BlockRewardHbbft:** reward generation and distribution. 

- **Certifier:** allows validators to use a zero gas price for service transactions such as reporting malicious validators and revealing secrets (see [Parity Wiki](https://wiki.parity.io/Permissioning.html#gas-price) for more info). 

- **InitializerHbbft:** Initializes upgradable contracts and is then destroyed. This contract's bytecode is written by the `scripts/make_spec_hbbft.js` into `spec.json` along with other contracts.

- **RandomHbbft:**  stores random numbers that the engine generates and sends, used for the validator selection. 

- **Registry:** stores human-readable keys associated with addresses (see [Parity Wiki](https://wiki.parity.io/Parity-name-registry.html)). Used primarily to store the address of the `Certifier` contract (see [Parity Wiki](https://wiki.parity.io/Permissioning.html#gas-price) for details).

- **StakingHbbft:** contains the contract staking logic for candidates, delegators and validators.

- **TxPermission:** controls the use of a zero gas price by validators in service transactions, protecting the network against "transaction spamming" by malicious validators. 

- **ValidatorSetHbbft:** stores the current validator set and contains the logic for new validators selection at the beginning of each staking epoch.