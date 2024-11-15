#!/bin/sh

# todo: figure out what contracts did have changed.

output_file="./scripts/upgrades/alpha4/2024_11_15_contracts.txt"

npx hardhat --network alpha4 getUpgradeCalldata --output "$output_file" --contract BlockRewardHbbft 
npx hardhat --network alpha4 getUpgradeCalldata --output "$output_file" --contract StakingHbbft
npx hardhat --network alpha4 getUpgradeCalldata --output "$output_file" --contract TxPermissionHbbft

# this update we need to set storage variables using reinitializer
npx hardhat --network alpha4 getUpgradeCalldata --output "$output_file" --contract ConnectivityTrackerHbbft --init-func initializeV2
