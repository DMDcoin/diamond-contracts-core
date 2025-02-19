#!/bin/sh

# todo: figure out what contracts did have changed.

output_file="2025_02_04_contracts.txt"

npx hardhat --network beta1 getUpgradeCalldata --output "$output_file" --contract StakingHbbft  --init-func updateStakingTransitionTimeframeLength


