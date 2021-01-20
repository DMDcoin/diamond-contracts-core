#!/bin/sh

export NETWORK_NAME="DPoSChain"
export NETWORK_ID="777001"
export OWNER="0x0102Ac5315c1Bd986A1da4F1FE1b4BCA36Fa4667"
export STAKING_EPOCH_DURATION="60"
export STAKING_TRANSITION_WINDOW_LENGTH="15"
export STAKE_WITHDRAW_DISALLOW_PERIOD="30"

# node ../openethereum/ethcore/engines/hbbft/hbbft_config_generator/keygen_history.json
node scripts/make_spec_hbbft.js ../openethereum/ethcore/engines/hbbft/hbbft_config_generator/keygen_history.json
