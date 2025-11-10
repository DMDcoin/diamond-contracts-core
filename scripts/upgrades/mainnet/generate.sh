#!/bin/sh

# todo: figure out what contracts did have changed.

output_file="2025_10_26_contracts.txt"

npx hardhat --network mainnet getUpgradeCalldata --no-storage-check --output "$output_file" --contract StakingHbbft --init-func initializeV2
