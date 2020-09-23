#!/bin/sh

export NETWORK_NAME="DPoSChain"
export NETWORK_ID="101"
export OWNER="0x32e4e4c7c5d1cea5db5f9202a9e4d99e56c91a24"
export STAKING_EPOCH_DURATION="60"
export STAKING_TRANSITION_WINDOW_LENGTH="15"
export STAKE_WITHDRAW_DISALLOW_PERIOD="30"

# node ../openethereum/ethcore/engines/hbbft/hbbft_config_generator/keygen_history.json
node scripts/make_spec_hbbft.js ../openethereum/ethcore/engines/hbbft/hbbft_config_generator/keygen_history.json
