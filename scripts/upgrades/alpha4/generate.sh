#!/bin/sh

# todo: figure out what contracts did have changed.

npx hardhat --network alpha4 getUpgradeCalldata --contract BlockRewardHbbft
# this update we need to set the 
npx hardhat --network alpha4 getUpgradeCalldata --contract ValidatorSetHbbft --init-func initializeV2 "0x1200000000000000000000000000000000000001" 
npx hardhat --network alpha4 getUpgradeCalldata --contract ConnectivityTrackerHbbft
npx hardhat --network alpha4 getUpgradeCalldata --contract StakingHbbft
npx hardhat --network alpha4 getUpgradeCalldata --contract TxPermissionHbbft
