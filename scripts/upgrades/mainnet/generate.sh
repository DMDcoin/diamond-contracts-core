#!/bin/sh

# todo: figure out what contracts did have changed.

output_file="2026_05_21_contracts.txt"

npx hardhat --network mainnet getUpgradeCalldata --no-storage-check --output "$output_file" --contract BlockRewardHbbft
